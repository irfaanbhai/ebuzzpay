-- =====================================================================
-- INR 24h lock, withdrawal hold/refund, multiple UPI IDs, 5 referrals
-- ---------------------------------------------------------------------
-- Run this AFTER recurring_deposit_bonus.sql - it redefines
-- release_due_slot_commissions(), approve_transaction(),
-- reject_transaction(), request_withdrawal(), get_wallet_summary(),
-- submit_upi_deposit(), withdrawals_today(), admin_update_balance(),
-- handle_new_user(), referral_rate_for(), get_team_stats(),
-- get_admin_users_extended() and check_and_expire_withdrawals().
--
-- Rules:
--   * Lock: only an INR (UPI) deposit is locked, and only for the first
--     24 hours after it is approved. After that the whole amount is
--     withdrawable. USDT deposits (and their bonus) are never locked.
--     Commission, referral bonus and admin credits are not locked any
--     more either - profiles.locked_balance is retired (kept at 0).
--   * Withdrawals are open at any time (no 10 AM - 5 PM window any more),
--     max 3 requests per day - rejected requests count towards the 3.
--   * The 5% bonus still repeats every 24 hours until a withdrawal.
--   * A withdrawal request takes the amount out of the wallet straight
--     away. Approve makes it final, reject puts it back in the wallet
--     (and resumes the 5% bonus, as before).
--   * Users can save several UPI IDs and pick any of them for a
--     withdrawal. Deposits are accepted from any UPI ID.
--   * Referral bonus is paid only for a user's first 5 referrals, and
--     new signups beyond 5 are not linked to the referrer.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns / tables
-- ---------------------------------------------------------------------
do $$
begin
    -- true when request_withdrawal() already took the amount out of the
    -- wallet; older pending requests (false) are still deducted on approve
    if not exists (select 1 from information_schema.columns
                   where table_name = 'transactions' and column_name = 'balance_held') then
        alter table public.transactions add column balance_held boolean not null default false;
    end if;
end $$;

create table if not exists public.user_payout_upis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  upi_id text not null check (upi_id ~ '^[a-z0-9._-]+@[a-z]+$'),
  created_at timestamptz not null default now(),
  unique (user_id, upi_id)
);

create index if not exists user_payout_upis_user_idx on public.user_payout_upis (user_id);

alter table public.user_payout_upis enable row level security;

drop policy if exists "Users can view own payout upis" on public.user_payout_upis;
create policy "Users can view own payout upis" on public.user_payout_upis
  for select using (auth.uid() = user_id);

drop policy if exists "Users can add own payout upis" on public.user_payout_upis;
create policy "Users can add own payout upis" on public.user_payout_upis
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can remove own payout upis" on public.user_payout_upis;
create policy "Users can remove own payout upis" on public.user_payout_upis
  for delete using (auth.uid() = user_id);

-- Keep every UPI a user has already used
insert into public.user_payout_upis (user_id, upi_id)
select distinct p.id, lower(trim(p.payout_upi))
from public.profiles p
where p.payout_upi is not null
  and lower(trim(p.payout_upi)) ~ '^[a-z0-9._-]+@[a-z]+$'
on conflict (user_id, upi_id) do nothing;

insert into public.user_payout_upis (user_id, upi_id)
select distinct t.user_id, lower(trim(t.upi_id))
from public.transactions t
where t.upi_id is not null
  and t.type in ('deposit', 'withdrawal')
  and lower(trim(t.upi_id)) ~ '^[a-z0-9._-]+@[a-z]+$'
on conflict (user_id, upi_id) do nothing;

-- Commission / bonus / admin credits are no longer locked
update public.profiles set locked_balance = 0 where coalesce(locked_balance, 0) <> 0;

-- Speeds up the per-user lookups below
create index if not exists transactions_user_type_created_idx
  on public.transactions (user_id, type, created_at desc);
create index if not exists slot_commissions_user_created_idx
  on public.slot_commissions (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- INR deposits approved in the last 24 hours. slot_commissions rows are
-- written at approval time, so created_at is the approval time.
-- ---------------------------------------------------------------------
create or replace function inr_locked_amount(target_user_id uuid)
returns numeric
language sql stable security definer
as $$
  select least(
    coalesce((
      select sum(sc.slot_amount)
      from public.slot_commissions sc
      join public.transactions t on t.id = sc.transaction_id
      where sc.user_id = target_user_id
        and sc.created_at > now() - interval '24 hours'
        and coalesce(t.currency, 'INR') <> 'USDT'
    ), 0),
    greatest(coalesce((select p.balance from public.profiles p where p.id = target_user_id), 0), 0)
  );
$$;

-- When the next locked INR deposit unlocks (null = nothing locked)
create or replace function inr_unlock_at(target_user_id uuid)
returns timestamptz
language sql stable security definer
as $$
  select min(sc.created_at) + interval '24 hours'
  from public.slot_commissions sc
  join public.transactions t on t.id = sc.transaction_id
  where sc.user_id = target_user_id
    and sc.created_at > now() - interval '24 hours'
    and coalesce(t.currency, 'INR') <> 'USDT';
$$;

-- ---------------------------------------------------------------------
-- Real withdrawal requests made today (IST), rejected ones included.
-- The simulated tool payouts written by the withdrawal history screen
-- carry a tool_id and do not use up the daily limit.
-- ---------------------------------------------------------------------
create or replace function withdrawals_today(target_user_id uuid)
returns int
language sql stable security definer
as $$
  select count(*)::int
  from public.transactions t
  where t.user_id = target_user_id
    and t.type = 'withdrawal'
    and t.tool_id is null
    and t.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
$$;

-- ---------------------------------------------------------------------
-- Recurring 5% bonus - same as before, but no longer locked
-- ---------------------------------------------------------------------
create or replace function release_due_slot_commissions(target_user_id uuid default null)
returns numeric
language plpgsql security definer
as $$
declare
  row_rec record;
  v_due timestamptz;
  v_cycle int;
  total_credited numeric := 0;
begin
  for row_rec in
    select * from public.slot_commissions
    where credited_at is null
      and mature_at <= now()
      and (target_user_id is null or user_id = target_user_id)
    order by mature_at
    for update skip locked
  loop
    v_due := row_rec.mature_at;
    v_cycle := row_rec.cycles_paid;

    while v_due <= now() loop
      v_cycle := v_cycle + 1;

      update public.profiles
        set balance = balance + row_rec.amount,
            total_commission = coalesce(total_commission, 0) + row_rec.amount
        where id = row_rec.user_id;

      insert into public.transactions (user_id, amount, type, status, payment_method, utr, created_at)
      values (
        row_rec.user_id,
        row_rec.amount,
        'commission',
        'approved',
        'slot_commission',
        'SLOT_' || replace(row_rec.id::text, '-', '') || '_' || v_cycle,
        v_due
      );

      total_credited := total_credited + row_rec.amount;
      v_due := v_due + interval '24 hours';
    end loop;

    -- Timer resets: next payout 24 hours after this one
    update public.slot_commissions
      set mature_at = v_due,
          cycles_paid = v_cycle
      where id = row_rec.id;
  end loop;

  return total_credited;
end;
$$;

-- ---------------------------------------------------------------------
-- Referral: flat 0.10%, only for the first 5 people a user refers
-- ---------------------------------------------------------------------
create or replace function referral_rate_for(referrer uuid)
returns numeric
language sql stable
as $$
  select case when exists (select 1 from public.profiles where referrer_id = referrer)
              then 0.0010 else 0 end;
$$;

-- true when target_user is one of the referrer's first 5 referrals
create or replace function is_rewarded_referral(referrer uuid, target_user uuid)
returns boolean
language sql stable security definer
as $$
  select target_user in (
    select p.id from public.profiles p
    where p.referrer_id = referrer
    order by p.created_at, p.id
    limit 5
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  referrer_code_input text;
  referrer_id_lookup uuid;
  referrer_count int;
BEGIN
  referrer_code_input := new.raw_user_meta_data->>'referrer_code';

  IF referrer_code_input IS NOT NULL THEN
    SELECT id INTO referrer_id_lookup
      FROM public.profiles WHERE referral_code = referrer_code_input;

    -- A single user can refer at most 5 people
    IF referrer_id_lookup IS NOT NULL THEN
      SELECT count(*) INTO referrer_count
        FROM public.profiles WHERE referrer_id = referrer_id_lookup;
      IF referrer_count >= 5 THEN
        referrer_id_lookup := NULL;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, referral_code, referrer_id)
  VALUES (
    new.id,
    new.email,
    substring(md5(random()::text) from 1 for 8),
    referrer_id_lookup
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- Approve
--   deposit    -> credit paid amount + USDT bonus (nothing locked here;
--                 the INR 24h lock is worked out from the approval time),
--                 start the 5% cycle, pay the referrer
--   withdrawal -> already taken from the wallet on request; only older
--                 requests (balance_held = false) are deducted now
-- ---------------------------------------------------------------------
create or replace function approve_transaction(transaction_id uuid)
returns void as $$
declare
  txn record;
  final_amount numeric;
  bonus numeric;
  current_balance numeric;
  v_referrer uuid;
  v_ref_rate numeric;
  v_ref_bonus numeric;
begin
  -- Lock the row so two admins can't approve the same request twice
  select * into txn from public.transactions where id = transaction_id for update;

  if not found then
    raise exception 'Transaction not found';
  end if;

  if txn.status <> 'pending' then
    return; -- Already approved or rejected, do nothing
  end if;

  final_amount := coalesce(txn.converted_amount, txn.amount);
  bonus := coalesce(txn.bonus_amount, 0);

  if txn.type = 'deposit' then
    update public.profiles
      set balance = balance + final_amount + bonus
      where id = txn.user_id;

    -- 5% every 24 hours, first payout 24 hours from now
    -- (no ON CONFLICT here: "transaction_id" would clash with this
    -- function's parameter of the same name)
    insert into public.slot_commissions (user_id, transaction_id, slot_amount, amount, rate, mature_at)
    select
      txn.user_id,
      txn.id,
      final_amount,
      round(final_amount * 0.05, 2),
      0.05,
      now() + interval '24 hours'
    where not exists (
      select 1 from public.slot_commissions sc where sc.transaction_id = txn.id
    );

    -- Referral bonus, only for the referrer's first 5 referrals
    select referrer_id into v_referrer from public.profiles where id = txn.user_id;

    if v_referrer is not null and is_rewarded_referral(v_referrer, txn.user_id) then
      v_ref_rate := referral_rate_for(v_referrer);
      v_ref_bonus := round(final_amount * v_ref_rate, 2);

      if v_ref_bonus > 0 then
        update public.profiles
          set balance = balance + v_ref_bonus,
              total_commission = coalesce(total_commission, 0) + v_ref_bonus
          where id = v_referrer;

        insert into public.transactions (user_id, amount, type, status, payment_method, utr)
        values (
          v_referrer,
          v_ref_bonus,
          'commission',
          'approved',
          'referral_bonus',
          'REF_' || replace(txn.id::text, '-', '')
        );
      end if;
    end if;

  elsif txn.type = 'withdrawal' and not coalesce(txn.balance_held, false) then
    -- Request made before the hold existed: deduct it now
    select balance into current_balance from public.profiles where id = txn.user_id for update;
    if current_balance < txn.amount then
      raise exception 'Insufficient balance to approve withdrawal';
    end if;
    update public.profiles
      set balance = balance - txn.amount
      where id = txn.user_id;
  end if;

  update public.transactions set status = 'approved' where id = transaction_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Reject: a held withdrawal goes back to the wallet, and the 5% bonus
-- it stopped carries on (missed payouts are caught up)
-- ---------------------------------------------------------------------
create or replace function reject_transaction(transaction_id uuid)
returns void as $$
declare
  v_rejected uuid;
  v_user uuid;
  v_amount numeric;
  v_type text;
  v_held boolean;
begin
  update public.transactions t
    set status = 'rejected'
    where t.id = reject_transaction.transaction_id and t.status = 'pending'
    returning t.id, t.user_id, t.amount, t.type, coalesce(t.balance_held, false)
    into v_rejected, v_user, v_amount, v_type, v_held;

  if v_rejected is not null then
    if v_type = 'withdrawal' and v_held then
      update public.profiles
        set balance = balance + v_amount
        where id = v_user;
    end if;

    update public.slot_commissions
      set credited_at = null,
          stopped_by = null
      where stopped_by = v_rejected;
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- The auto-expiry is only meant for the simulated tool payouts. A real
-- request holds the user's money, so it must wait for approve / reject.
-- ---------------------------------------------------------------------
create or replace function check_and_expire_withdrawals()
returns void as $$
begin
    update public.transactions
    set status = 'expired'
    where type = 'withdrawal'
      and tool_id is not null
      and status in ('approved', 'pending')
      and created_at < (now() - interval '5 minutes');
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Admin balance edit: plain set, nothing is locked any more
-- ---------------------------------------------------------------------
create or replace function admin_update_balance(user_id uuid, new_balance decimal)
returns void
language plpgsql security definer
as $$
begin
  update public.profiles p
    set balance = new_balance,
        locked_balance = 0
    where p.id = admin_update_balance.user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- UPI deposit: any UPI ID is accepted and saved to the user's list
-- ---------------------------------------------------------------------
create or replace function submit_upi_deposit(
  p_amount numeric,
  p_utr text,
  p_upi_id text,
  p_method text default 'upi'
)
returns uuid
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_upi text;
  v_utr text;
  v_txn_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  if p_amount is null or p_amount < 500 then
    raise exception 'Minimum deposit is Rs 500';
  end if;

  v_utr := trim(coalesce(p_utr, ''));
  if v_utr = '' then
    raise exception 'Please enter the UTR number';
  end if;

  v_upi := lower(trim(coalesce(p_upi_id, '')));
  if v_upi !~ '^[a-z0-9._-]+@[a-z]+$' then
    raise exception 'Invalid UPI ID format. Example: 9876543210@paytm';
  end if;

  if exists (select 1 from public.transactions
             where utr = v_utr and status <> 'rejected') then
    raise exception 'This UTR has already been submitted';
  end if;

  insert into public.user_payout_upis (user_id, upi_id)
  values (v_user_id, v_upi)
  on conflict (user_id, upi_id) do nothing;

  update public.profiles
    set payout_upi = coalesce(payout_upi, v_upi)
    where id = v_user_id;

  insert into public.transactions (user_id, amount, type, status, payment_method, utr, upi_id)
  values (v_user_id, p_amount, 'deposit', 'pending', coalesce(p_method, 'upi'), v_utr, v_upi)
  returning id into v_txn_id;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Withdrawal request: pick any UPI, amount leaves the wallet right away
-- ---------------------------------------------------------------------
drop function if exists request_withdrawal(numeric);

create or replace function request_withdrawal(p_amount numeric, p_upi_id text default null)
returns uuid
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_upi text;
  v_locked numeric;
  v_available numeric;
  v_unlock_at timestamptz;
  v_txn_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Please enter a valid amount';
  end if;

  -- Pays every bonus cycle that is already due before it is stopped
  perform release_due_slot_commissions(v_user_id);

  -- Row lock also serialises parallel requests, so the daily count holds
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  if coalesce(v_profile.is_banned, false) then
    raise exception 'Your account is suspended';
  end if;

  v_upi := lower(trim(coalesce(nullif(trim(p_upi_id), ''), v_profile.payout_upi, '')));
  if v_upi = '' then
    raise exception 'Please add a UPI ID to receive the withdrawal';
  end if;
  if v_upi !~ '^[a-z0-9._-]+@[a-z]+$' then
    raise exception 'Invalid UPI ID format. Example: 9876543210@paytm';
  end if;

  if withdrawals_today(v_user_id) >= 3 then
    raise exception 'You can make only 3 withdrawals per day. Try again tomorrow.';
  end if;

  if p_amount > coalesce(v_profile.balance, 0) then
    raise exception 'Insufficient balance';
  end if;

  v_locked := inr_locked_amount(v_user_id);
  v_available := coalesce(v_profile.balance, 0) - v_locked;

  if p_amount > v_available then
    v_unlock_at := inr_unlock_at(v_user_id);
    raise exception 'Rs % from your INR deposit is locked for its first 24 hours (unlocks at % IST). You can withdraw up to Rs % now.',
      to_char(v_locked, 'FM999999990.00'),
      to_char(v_unlock_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'),
      to_char(greatest(v_available, 0), 'FM999999990.00');
  end if;

  insert into public.transactions (user_id, amount, type, status, payment_method, utr, upi_id, balance_held)
  values (
    v_user_id,
    p_amount,
    'withdrawal',
    'pending',
    'upi',
    'WD_' || floor(extract(epoch from now()))::text || '_' || floor(random() * 1000)::text,
    v_upi,
    true
  )
  returning id into v_txn_id;

  -- Held until the admin decides: approve keeps it out, reject returns it
  update public.profiles
    set balance = balance - p_amount,
        payout_upi = v_upi
    where id = v_user_id;

  insert into public.user_payout_upis (user_id, upi_id)
  values (v_user_id, v_upi)
  on conflict (user_id, upi_id) do nothing;

  -- Withdrawing ends the recurring 5% bonus on every running deposit
  update public.slot_commissions
    set credited_at = now(),
        stopped_by = v_txn_id
    where user_id = v_user_id
      and credited_at is null;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Wallet summary: everything the Assets screen needs in one call
-- ---------------------------------------------------------------------
create or replace function get_wallet_summary()
returns json
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_pending numeric;
  v_next timestamptz;
  v_running numeric;
  v_locked numeric;
  v_in_process numeric;
  v_upis json;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  perform release_due_slot_commissions(v_user_id);

  select * into v_profile from public.profiles where id = v_user_id;
  if not found then
    raise exception 'Profile not found';
  end if;

  -- pending = what the running deposits pay out every 24 hours
  select coalesce(sum(amount), 0), min(mature_at), coalesce(sum(slot_amount), 0)
    into v_pending, v_next, v_running
    from public.slot_commissions
    where user_id = v_user_id and credited_at is null;

  v_locked := inr_locked_amount(v_user_id);

  select coalesce(sum(amount), 0) into v_in_process
    from public.transactions
    where user_id = v_user_id
      and type = 'withdrawal'
      and status = 'pending'
      and balance_held;

  select coalesce(json_agg(u.upi_id order by u.created_at), '[]'::json) into v_upis
    from public.user_payout_upis u
    where u.user_id = v_user_id;

  return json_build_object(
    'balance', coalesce(v_profile.balance, 0),
    'locked_balance', v_locked,
    'locked_until', inr_unlock_at(v_user_id),
    'withdrawable', greatest(coalesce(v_profile.balance, 0) - v_locked, 0),
    'withdrawal_in_process', v_in_process,
    'pending_commission', v_pending,
    'next_commission_at', v_next,
    'bonus_running_amount', v_running,
    'payout_upi', v_profile.payout_upi,
    'payout_upis', v_upis,
    'withdrawals_today', withdrawals_today(v_user_id),
    'withdrawal_daily_limit', 3,
    'withdraw_window_open', true,
    'today_earnings', today_earnings_for(v_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Team stats: 5 referral limit
-- ---------------------------------------------------------------------
create or replace function get_team_stats(query_user_id uuid)
returns json as $$
declare
  total_comm decimal;
  comm_today decimal;
  comm_yest decimal;
  team_cnt int;
  team_cnt_b int;
  team_cnt_c int;
  new_team_cnt int;
  ref_earned decimal;
  ref_rate numeric;
begin
  select total_commission into total_comm from public.profiles where id = query_user_id;

  select coalesce(sum(amount), 0) into comm_today
    from public.transactions
    where user_id = query_user_id and type = 'commission'
      and created_at >= ist_day_start()
      and created_at <= now();

  select coalesce(sum(amount), 0) into comm_yest
    from public.transactions
    where user_id = query_user_id and type = 'commission'
      and created_at >= ist_day_start() - interval '1 day'
      and created_at < ist_day_start();

  select coalesce(sum(amount), 0) into ref_earned
    from public.transactions
    where user_id = query_user_id and type = 'commission'
      and payment_method = 'referral_bonus';

  -- Level A (Direct)
  select count(*) into team_cnt from public.profiles where referrer_id = query_user_id;

  -- Level B (Indirect L2)
  select count(*) into team_cnt_b from public.profiles where referrer_id in (
    select id from public.profiles where referrer_id = query_user_id
  );

  -- Level C (Indirect L3)
  select count(*) into team_cnt_c from public.profiles where referrer_id in (
    select id from public.profiles where referrer_id in (
      select id from public.profiles where referrer_id = query_user_id
    )
  );

  -- New Team (joined last 24h)
  select count(*) into new_team_cnt from public.profiles
    where referrer_id = query_user_id and created_at > now() - interval '24 hours';

  ref_rate := referral_rate_for(query_user_id);

  return json_build_object(
    'total_commission', coalesce(total_comm, 0),
    'commission_today', comm_today,
    'commission_yesterday', comm_yest,
    'team_count', team_cnt,
    'level_b_count', team_cnt_b,
    'level_c_count', team_cnt_c,
    'today_new_team', new_team_cnt,
    'referral_earned', ref_earned,
    'referral_rate', ref_rate * 100,
    'referral_limit', 5,
    'referral_slots_left', greatest(5 - team_cnt, 0)
  );
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Admin users list: "Locked" now shows the INR 24h lock
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_admin_users_extended(
  search_query text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  email text,
  balance decimal(12, 2),
  locked_balance decimal(12, 2),
  payout_upi text,
  is_banned boolean,
  created_at timestamp with time zone,
  today_earnings decimal,
  tools jsonb
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Credit anything past its 24h wait so balances are current
  PERFORM release_due_slot_commissions();

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.balance,
    inr_locked_amount(p.id)::decimal(12, 2) AS locked_balance,
    p.payout_upi,
    COALESCE(p.is_banned, false) as is_banned,
    p.created_at,
    today_earnings_for(p.id) AS today_earnings,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ut.id,
        'upi_id', ut.upi_id,
        'status', ut.status,
        'platform', ut.platform
      ))
      FROM public.user_tools ut
      WHERE ut.user_id = p.id
    ), '[]'::jsonb) AS tools
  FROM public.profiles p
  WHERE
    (search_query IS NULL OR
     p.email ILIKE '%' || search_query || '%' OR
     p.payout_upi ILIKE '%' || search_query || '%' OR
     p.id::text ILIKE '%' || search_query || '%')
  ORDER BY
    p.balance DESC NULLS LAST,
    p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
