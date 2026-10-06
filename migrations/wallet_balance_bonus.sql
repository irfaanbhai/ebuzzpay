-- =====================================================================
-- 5% bonus on the wallet balance, timer keeps running through withdrawals
-- ---------------------------------------------------------------------
-- Run this AFTER inr_lock_withdraw_hold_multi_upi.sql and
-- fix_reject_resumes_bonus.sql - it redefines
-- release_due_slot_commissions(), approve_transaction(),
-- reject_transaction(), request_withdrawal(), admin_update_balance()
-- and get_wallet_summary(), and adds get_bonus_cycle().
--
-- Rules:
--   * One 24 hour timer per user. The first approved deposit starts it
--     (or the first deposit after the wallet was emptied). Later
--     deposits do not reset it.
--   * Every 24 hours the user gets 5% of their wallet balance, bonus and
--     earlier commission included (so it compounds).
--   * Money deposited in the last 24 hours is left out of that payout
--     and counted from the next one.
--       e.g. deposit 2000, 10h later deposit 2000 more:
--            1st payout -> 5% of 2000 = 100
--            2nd payout -> 5% of 4100 = 205
--   * A withdrawal does not stop the timer. The amount leaves the wallet
--     on request, so the next payout is just smaller.
--   * The timer stops only when the wallet reaches 0.
--
-- State lives on profiles (bonus_next_at / bonus_cycles).
-- slot_commissions is kept as the record of when each deposit was
-- approved (the INR 24h lock reads it); its own timer is retired.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pay out anything still due under the old per-deposit rules first
-- (this is still the old release_due_slot_commissions)
-- ---------------------------------------------------------------------
select release_due_slot_commissions();

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_name = 'profiles' and column_name = 'bonus_next_at') then
        alter table public.profiles add column bonus_next_at timestamptz;
    end if;

    if not exists (select 1 from information_schema.columns
                   where table_name = 'profiles' and column_name = 'bonus_cycles') then
        alter table public.profiles add column bonus_cycles int not null default 0;
    end if;
end $$;

create index if not exists profiles_bonus_next_at_idx
  on public.profiles (bonus_next_at) where bonus_next_at is not null;

-- ---------------------------------------------------------------------
-- Move existing users onto the wallet timer
-- ---------------------------------------------------------------------

-- Bonus still running: keep the user's current countdown
update public.profiles p
  set bonus_next_at = s.next_at
  from (
    select user_id, min(mature_at) as next_at
    from public.slot_commissions
    where credited_at is null
    group by user_id
  ) s
  where p.id = s.user_id
    and coalesce(p.balance, 0) > 0;

-- Bonus was stopped by a withdrawal but money is still in the wallet:
-- under the new rules that money earns, so start a fresh 24 hours
update public.profiles p
  set bonus_next_at = now() + interval '24 hours'
  where p.bonus_next_at is null
    and coalesce(p.balance, 0) > 0
    and exists (select 1 from public.slot_commissions sc where sc.user_id = p.id);

-- Old per-deposit timers are finished
update public.slot_commissions
  set credited_at = now()
  where credited_at is null;

-- ---------------------------------------------------------------------
-- Money credited by deposits approved after `since` (paid amount plus
-- any USDT bonus). That money has not been in the wallet a full 24 hours
-- yet, so it is left out of the payout.
-- ---------------------------------------------------------------------
create or replace function recent_deposit_credit(target_user_id uuid, since timestamptz)
returns numeric
language sql stable security definer
as $$
  select coalesce(sum(coalesce(t.converted_amount, t.amount) + coalesce(t.bonus_amount, 0)), 0)
  from public.slot_commissions sc
  join public.transactions t on t.id = sc.transaction_id
  where sc.user_id = target_user_id
    and sc.created_at > since;
$$;

-- ---------------------------------------------------------------------
-- Pay every 24 hour cycle that has come due. Missed cycles are caught
-- up, each dated when it was due. Every balance change (deposit
-- approval, withdrawal request, admin edit) settles first, so the
-- current balance is the balance at each due time.
-- ---------------------------------------------------------------------
create or replace function release_due_slot_commissions(target_user_id uuid default null)
returns numeric
language plpgsql security definer
as $$
declare
  p record;
  v_due timestamptz;
  v_cycle int;
  v_balance numeric;
  v_base numeric;
  v_pay numeric;
  total_credited numeric := 0;
begin
  for p in
    select id, balance, bonus_next_at, bonus_cycles
    from public.profiles
    where bonus_next_at is not null
      and bonus_next_at <= now()
      and (target_user_id is null or id = target_user_id)
    order by bonus_next_at
    for update skip locked
  loop
    v_due := p.bonus_next_at;
    v_cycle := p.bonus_cycles;
    v_balance := coalesce(p.balance, 0);

    while v_due is not null and v_due <= now() loop
      -- Wallet emptied: the timer stops
      if v_balance <= 0 then
        v_due := null;
        exit;
      end if;

      v_base := greatest(v_balance - recent_deposit_credit(p.id, v_due - interval '24 hours'), 0);
      v_pay := round(v_base * 0.05, 2);

      if v_pay > 0 then
        v_cycle := v_cycle + 1;
        v_balance := v_balance + v_pay;

        insert into public.transactions (user_id, amount, type, status, payment_method, utr, created_at)
        values (
          p.id,
          v_pay,
          'commission',
          'approved',
          'slot_commission',
          'BONUS_' || replace(p.id::text, '-', '') || '_' || v_cycle,
          v_due
        );

        total_credited := total_credited + v_pay;
      end if;

      v_due := v_due + interval '24 hours';
    end loop;

    update public.profiles
      set balance = v_balance,
          total_commission = coalesce(total_commission, 0) + (v_balance - coalesce(p.balance, 0)),
          bonus_next_at = v_due,
          bonus_cycles = v_cycle
      where id = p.id;
  end loop;

  return total_credited;
end;
$$;

-- ---------------------------------------------------------------------
-- Approve
--   deposit    -> settle due cycles, credit the deposit, start the timer
--                 if it is not running, pay the referrer
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

  -- Pay what was due on the old balance before it changes
  perform release_due_slot_commissions(txn.user_id);

  if txn.type = 'deposit' then
    update public.profiles
      set balance = balance + final_amount + bonus,
          -- a running timer is not reset by another deposit
          bonus_next_at = coalesce(bonus_next_at, now() + interval '24 hours')
      where id = txn.user_id;

    -- Approval record: the INR 24h lock and the "deposited in the last
    -- 24 hours" rule read created_at. credited_at is filled so the old
    -- per-deposit timer never picks it up.
    -- (no ON CONFLICT here: "transaction_id" would clash with this
    -- function's parameter of the same name)
    insert into public.slot_commissions (user_id, transaction_id, slot_amount, amount, rate, mature_at, credited_at)
    select
      txn.user_id,
      txn.id,
      final_amount,
      round(final_amount * 0.05, 2),
      0.05,
      now() + interval '24 hours',
      now()
    where not exists (
      select 1 from public.slot_commissions sc where sc.transaction_id = txn.id
    );

    -- Referral bonus, only for the referrer's first 5 referrals
    select referrer_id into v_referrer from public.profiles where id = txn.user_id;

    if v_referrer is not null and is_rewarded_referral(v_referrer, txn.user_id) then
      v_ref_rate := referral_rate_for(v_referrer);
      v_ref_bonus := round(final_amount * v_ref_rate, 2);

      if v_ref_bonus > 0 then
        perform release_due_slot_commissions(v_referrer);

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
      set balance = balance - txn.amount,
          bonus_next_at = case when balance - txn.amount <= 0 then null else bonus_next_at end
      where id = txn.user_id;
  end if;

  update public.transactions set status = 'approved' where id = transaction_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Reject: a held withdrawal goes back to the wallet. If taking it out
-- had emptied the wallet (timer stopped), a fresh 24 hours starts.
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

  if v_rejected is not null and v_type = 'withdrawal' and v_held then
    perform release_due_slot_commissions(v_user);

    update public.profiles
      set balance = balance + v_amount,
          bonus_next_at = case
            when bonus_next_at is null and balance + v_amount > 0
              then now() + interval '24 hours'
            else bonus_next_at
          end
      where id = v_user;
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Withdrawal request: same checks as before, but the bonus keeps
-- running; it stops only if this empties the wallet
-- ---------------------------------------------------------------------
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

  -- Pay every bonus cycle that is already due on the current balance
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

  -- Held until the admin decides: approve keeps it out, reject returns it.
  -- The timer keeps running unless the wallet is now empty.
  update public.profiles
    set balance = balance - p_amount,
        payout_upi = v_upi,
        bonus_next_at = case when balance - p_amount <= 0 then null else bonus_next_at end
    where id = v_user_id;

  insert into public.user_payout_upis (user_id, upi_id)
  values (v_user_id, v_upi)
  on conflict (user_id, upi_id) do nothing;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin balance edit: settle first so the old balance earns what it was
-- due; setting the wallet to 0 stops the timer
-- ---------------------------------------------------------------------
create or replace function admin_update_balance(user_id uuid, new_balance decimal)
returns void
language plpgsql security definer
as $$
begin
  perform release_due_slot_commissions(admin_update_balance.user_id);

  update public.profiles p
    set balance = new_balance,
        locked_balance = 0,
        bonus_next_at = case when new_balance <= 0 then null else p.bonus_next_at end
    where p.id = admin_update_balance.user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Next payout for one user: when, on how much, and how much it pays
-- ---------------------------------------------------------------------
create or replace function bonus_cycle_for(target_user_id uuid)
returns json
language sql stable security definer
as $$
  select json_build_object(
    'next_at', p.bonus_next_at,
    'base', case when p.bonus_next_at is null then 0 else b.base end,
    'payout', case when p.bonus_next_at is null then 0 else round(b.base * 0.05, 2) end
  )
  from public.profiles p
  cross join lateral (
    select greatest(
      coalesce(p.balance, 0)
        - recent_deposit_credit(p.id, coalesce(p.bonus_next_at, now()) - interval '24 hours'),
      0
    ) as base
  ) b
  where p.id = target_user_id;
$$;

-- Timer for the Home and Assets pages
create or replace function get_bonus_cycle()
returns json
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  perform release_due_slot_commissions(v_user_id);
  return bonus_cycle_for(v_user_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Wallet summary: bonus fields come from the wallet timer
-- ---------------------------------------------------------------------
create or replace function get_wallet_summary()
returns json
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_cycle json;
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

  v_cycle := bonus_cycle_for(v_user_id);
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
    -- next payout amount, when it comes and the balance it is 5% of
    'pending_commission', (v_cycle->>'payout')::numeric,
    'next_commission_at', v_profile.bonus_next_at,
    'bonus_running_amount', (v_cycle->>'base')::numeric,
    'payout_upi', v_profile.payout_upi,
    'payout_upis', v_upis,
    'withdrawals_today', withdrawals_today(v_user_id),
    'withdrawal_daily_limit', 3,
    'withdraw_window_open', true,
    'today_earnings', today_earnings_for(v_user_id)
  );
end;
$$;
