-- =====================================================================
-- Withdrawal limits
-- ---------------------------------------------------------------------
-- Run this AFTER commission_and_referral_rules.sql - it redefines
-- request_withdrawal() and get_wallet_summary() on top of that version.
--
-- Rules:
--   * Deposit hold: nothing can be withdrawn until 24 hours after the
--     user's latest approved deposit. Every new deposit restarts the
--     24 hours. Once they pass, the user can withdraw until they deposit
--     again.
--   * At most 3 withdrawal requests per day (Indian calendar day).
--     Rejected requests do not use up a chance.
-- =====================================================================

-- ---------------------------------------------------------------------
-- When the user's deposit hold ends (null = no hold)
-- ---------------------------------------------------------------------
create or replace function withdrawal_unlock_at(target_user_id uuid)
returns timestamptz
language sql stable security definer
as $$
  select nullif(greatest(
    -- slot_commissions rows are written at approval time, so mature_at
    -- is exactly approval + 24h
    coalesce((
      select max(sc.mature_at)
      from public.slot_commissions sc
      where sc.user_id = target_user_id
    ), '-infinity'::timestamptz),
    -- deposits approved before slot_commissions existed: fall back to
    -- the request time
    coalesce((
      select max(t.created_at) + interval '24 hours'
      from public.transactions t
      where t.user_id = target_user_id
        and t.type = 'deposit'
        and t.status = 'approved'
    ), '-infinity'::timestamptz)
  ), '-infinity'::timestamptz);
$$;

-- ---------------------------------------------------------------------
-- Withdrawal requests made today (IST), not counting rejected ones
-- ---------------------------------------------------------------------
create or replace function withdrawals_today(target_user_id uuid)
returns int
language sql stable security definer
as $$
  select count(*)::int
  from public.transactions t
  where t.user_id = target_user_id
    and t.type = 'withdrawal'
    and t.status <> 'rejected'
    and t.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
$$;

-- ---------------------------------------------------------------------
-- Withdrawal request with the new limits
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
  v_unlock_at timestamptz;
  v_txn_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Please enter a valid amount';
  end if;

  perform release_due_slot_commissions(v_user_id);

  -- Row lock also serialises parallel requests, so the daily count holds
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

  v_unlock_at := withdrawal_unlock_at(v_user_id);
  if v_unlock_at is not null and v_unlock_at > now() then
    raise exception 'You can withdraw 24 hours after your last deposit. Withdrawal opens at % IST.',
      to_char(v_unlock_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM');
  end if;

  if withdrawals_today(v_user_id) >= 3 then
    raise exception 'You can make only 3 withdrawals per day. Try again tomorrow.';
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
-- Wallet summary: also report the limits so the app can show them
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
  v_unlock_at timestamptz;
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

  v_unlock_at := withdrawal_unlock_at(v_user_id);

  return json_build_object(
    'balance', coalesce(v_profile.balance, 0),
    'locked_balance', coalesce(v_profile.locked_balance, 0),
    'withdrawable', greatest(coalesce(v_profile.balance, 0) - coalesce(v_profile.locked_balance, 0), 0),
    'pending_commission', v_pending,
    'next_commission_at', v_next,
    'payout_upi', v_profile.payout_upi,
    'withdraw_unlock_at', case when v_unlock_at > now() then v_unlock_at end,
    'withdrawals_today', withdrawals_today(v_user_id),
    'withdrawal_daily_limit', 3
  );
end;
$$;
