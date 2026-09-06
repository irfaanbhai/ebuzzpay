-- =====================================================================
-- Slot commission (5%, paid 24 hours after approval) + referral tiers
-- ---------------------------------------------------------------------
-- Run this AFTER locked_balance_and_upi_lock.sql - it redefines
-- approve_transaction() on top of that version.
--
-- Rules implemented here:
--   * Buying a slot earns 5% commission, credited 24 HOURS after the
--     deposit is approved (not immediately).
--   * That commission is LOCKED: the user has to put it on a slot before
--     it can be withdrawn, same as any other bonus.
--   * Referring users pays the referrer a % of every slot their referral
--     buys, credited when that deposit is approved:
--         1 - 5  referrals -> 0.10%
--         6 - 9  referrals -> 0.20%
--        10      referrals -> 0.50%
--     The referral bonus is locked as well.
--   * A single user can refer at most 10 people.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pending slot commissions
-- ---------------------------------------------------------------------
create table if not exists public.slot_commissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) not null,
  transaction_id uuid references public.transactions(id) unique,
  slot_amount numeric(12, 2) not null,
  amount numeric(12, 2) not null,
  rate numeric(6, 4) not null,
  mature_at timestamptz not null,
  credited_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists slot_commissions_due_idx
  on public.slot_commissions (mature_at) where credited_at is null;
create index if not exists slot_commissions_user_idx
  on public.slot_commissions (user_id);

alter table public.slot_commissions enable row level security;
drop policy if exists "Users can view own slot commissions" on public.slot_commissions;
create policy "Users can view own slot commissions" on public.slot_commissions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Referral rate for a given referrer, based on how many people they
-- have referred so far.
-- ---------------------------------------------------------------------
create or replace function referral_rate_for(referrer uuid)
returns numeric
language plpgsql stable
as $$
declare
  ref_count int;
begin
  select count(*) into ref_count from public.profiles where referrer_id = referrer;

  if ref_count >= 10 then
    return 0.0050;  -- 0.50%
  elsif ref_count > 5 then
    return 0.0020;  -- 0.20%
  elsif ref_count >= 1 then
    return 0.0010;  -- 0.10%
  else
    return 0;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Cap referrals at 10 per user: an 11th signup still registers, it just
-- does not get linked to that referrer.
-- ---------------------------------------------------------------------
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

    -- A single user can refer at most 10 people
    IF referrer_id_lookup IS NOT NULL THEN
      SELECT count(*) INTO referrer_count
        FROM public.profiles WHERE referrer_id = referrer_id_lookup;
      IF referrer_count >= 10 THEN
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
-- Approve: credit deposits, release the lock, schedule the 5% slot
-- commission for +24h, and pay the referrer their tier bonus.
-- ---------------------------------------------------------------------
create or replace function approve_transaction(transaction_id uuid)
returns void as $$
declare
  txn record;
  final_amount numeric;
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

  -- For deposits, credit the converted amount if present (USDT), else amount.
  final_amount := coalesce(txn.converted_amount, txn.amount);

  if txn.type = 'deposit' then
    update public.profiles
      set balance = balance + final_amount,
          -- the user put money on a slot, so release that much of the lock
          locked_balance = greatest(0, coalesce(locked_balance, 0) - final_amount)
      where id = txn.user_id;

    -- 5% slot commission, payable 24 hours from now
    insert into public.slot_commissions (user_id, transaction_id, slot_amount, amount, rate, mature_at)
    values (
      txn.user_id,
      txn.id,
      final_amount,
      round(final_amount * 0.05, 2),
      0.05,
      now() + interval '24 hours'
    )
    on conflict (transaction_id) do nothing;

    -- Referral bonus for whoever invited this user
    select referrer_id into v_referrer from public.profiles where id = txn.user_id;

    if v_referrer is not null then
      v_ref_rate := referral_rate_for(v_referrer);
      v_ref_bonus := round(final_amount * v_ref_rate, 2);

      if v_ref_bonus > 0 then
        -- Bonus money is locked until it is put on a slot
        update public.profiles
          set balance = balance + v_ref_bonus,
              locked_balance = coalesce(locked_balance, 0) + v_ref_bonus,
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

  elsif txn.type = 'withdrawal' then
    -- Balance is held until approval, so deduct it now.
    select balance into current_balance from public.profiles where id = txn.user_id;
    if current_balance < txn.amount then
      raise exception 'Insufficient balance to approve withdrawal';
    end if;
    update public.profiles
      set balance = balance - txn.amount,
          -- the lock can never exceed the remaining balance
          locked_balance = least(coalesce(locked_balance, 0), balance - txn.amount)
      where id = txn.user_id;
  end if;

  update public.transactions set status = 'approved' where id = transaction_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Pay out every slot commission that has passed its 24 hour maturity.
-- Safe to call from anywhere: already-credited rows are skipped.
-- Pass a user id to settle just that user, or nothing to settle all.
-- ---------------------------------------------------------------------
create or replace function release_due_slot_commissions(target_user_id uuid default null)
returns numeric
language plpgsql security definer
as $$
declare
  row_rec record;
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
    -- Slot commission is bonus money: credited to the wallet but locked
    -- until the user puts it on a slot.
    update public.profiles
      set balance = balance + row_rec.amount,
          locked_balance = coalesce(locked_balance, 0) + row_rec.amount,
          total_commission = coalesce(total_commission, 0) + row_rec.amount
      where id = row_rec.user_id;

    insert into public.transactions (user_id, amount, type, status, payment_method, utr)
    values (
      row_rec.user_id,
      row_rec.amount,
      'commission',
      'approved',
      'slot_commission',
      'SLOT_' || replace(row_rec.id::text, '-', '')
    );

    update public.slot_commissions
      set credited_at = now()
      where id = row_rec.id;

    total_credited := total_credited + row_rec.amount;
  end loop;

  return total_credited;
end;
$$;

-- ---------------------------------------------------------------------
-- Withdrawal: settle anything that has matured before checking the
-- locked balance, so a user is never told to wait for their own money.
-- ---------------------------------------------------------------------
create or replace function request_withdrawal(p_amount numeric)
returns uuid
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_locked numeric;
  v_available numeric;
  v_txn_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Please enter a valid amount';
  end if;

  perform release_due_slot_commissions(v_user_id);

  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  if coalesce(v_profile.is_banned, false) then
    raise exception 'Your account is suspended';
  end if;

  if v_profile.payout_upi is null then
    raise exception 'Buy a slot first. Withdrawals are paid only to the UPI ID you deposited from.';
  end if;

  if p_amount > coalesce(v_profile.balance, 0) then
    raise exception 'Insufficient balance';
  end if;

  v_locked := coalesce(v_profile.locked_balance, 0);
  v_available := coalesce(v_profile.balance, 0) - v_locked;

  if p_amount > v_available then
    raise exception 'Rs % of your balance has not been used on a slot yet. Put it on a slot before withdrawing (withdrawable: Rs %).',
      to_char(v_locked, 'FM999999990.00'),
      to_char(greatest(v_available, 0), 'FM999999990.00');
  end if;

  insert into public.transactions (user_id, amount, type, status, payment_method, utr, upi_id)
  values (
    v_user_id,
    p_amount,
    'withdrawal',
    'pending',
    'upi',
    'WD_' || floor(extract(epoch from now()))::text || '_' || floor(random() * 1000)::text,
    v_profile.payout_upi
  )
  returning id into v_txn_id;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Wallet summary for the Assets screen: settles matured commissions and
-- reports what is still waiting for its 24 hours to pass.
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
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  perform release_due_slot_commissions(v_user_id);

  select * into v_profile from public.profiles where id = v_user_id;
  if not found then
    raise exception 'Profile not found';
  end if;

  select coalesce(sum(amount), 0), min(mature_at)
    into v_pending, v_next
    from public.slot_commissions
    where user_id = v_user_id and credited_at is null;

  return json_build_object(
    'balance', coalesce(v_profile.balance, 0),
    'locked_balance', coalesce(v_profile.locked_balance, 0),
    'withdrawable', greatest(coalesce(v_profile.balance, 0) - coalesce(v_profile.locked_balance, 0), 0),
    'pending_commission', v_pending,
    'next_commission_at', v_next,
    'payout_upi', v_profile.payout_upi
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Team stats: real commission figures plus the referral tier the user
-- is currently on.
-- ---------------------------------------------------------------------
drop function if exists get_team_stats(uuid) cascade;
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
      and created_at >= current_date;

  select coalesce(sum(amount), 0) into comm_yest
    from public.transactions
    where user_id = query_user_id and type = 'commission'
      and created_at >= current_date - interval '1 day'
      and created_at < current_date;

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
    'referral_limit', 10,
    'referral_slots_left', greatest(10 - team_cnt, 0)
  );
end;
$$ language plpgsql security definer;
