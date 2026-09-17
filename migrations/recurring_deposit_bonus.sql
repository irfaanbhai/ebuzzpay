-- =====================================================================
-- Recurring 5% deposit bonus + withdrawal time window
-- ---------------------------------------------------------------------
-- Run this AFTER withdrawal_limits.sql and admin_today_earnings_fix.sql -
-- it redefines release_due_slot_commissions(), withdrawal_unlock_at(),
-- request_withdrawal(), reject_transaction(), get_wallet_summary() and
-- today_earnings_for() on top of those versions.
--
-- Rules:
--   * An approved deposit earns 5% of its amount every 24 hours, not just
--     once. Each payout starts the next 24 hours.
--   * The bonus keeps repeating until the user requests a withdrawal. A
--     withdrawal request stops the bonus on every deposit made before it.
--     If the admin rejects that withdrawal, the bonus carries on as if it
--     had never been requested (missed payouts are caught up).
--   * Deposits made after a withdrawal start their own new 5% cycle.
--   * Withdrawals are only accepted between 10:00 AM and 5:00 PM IST.
--   * The 24 hour hold after the latest deposit still applies.
--
-- slot_commissions rows now mean:
--   credited_at is null  -> bonus running, next payout at mature_at
--   credited_at not null -> finished (stopped by a withdrawal, or a
--                           one-off commission from before this change)
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_name = 'slot_commissions' and column_name = 'cycles_paid') then
        alter table public.slot_commissions add column cycles_paid int not null default 0;
    end if;

    if not exists (select 1 from information_schema.columns
                   where table_name = 'slot_commissions' and column_name = 'stopped_by') then
        alter table public.slot_commissions
          add column stopped_by uuid references public.transactions(id);
    end if;
end $$;

-- ---------------------------------------------------------------------
-- Pay every 24 hour cycle that has come due, and schedule the next one.
-- A user who has not opened the app for a few days gets every missed
-- payout, each dated at the moment it was due.
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

      -- Bonus money: credited to the wallet but locked until the user
      -- puts it on a slot.
      update public.profiles
        set balance = balance + row_rec.amount,
            locked_balance = coalesce(locked_balance, 0) + row_rec.amount,
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
-- Deposit hold: 24 hours after the latest approved deposit.
-- mature_at now rolls forward every day, so use the row's creation time
-- (written when the deposit was approved) instead.
-- ---------------------------------------------------------------------
create or replace function withdrawal_unlock_at(target_user_id uuid)
returns timestamptz
language sql stable security definer
as $$
  select nullif(greatest(
    coalesce((
      select max(sc.created_at) + interval '24 hours'
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
-- Withdrawal window: 10:00 AM (inclusive) to 5:00 PM (exclusive) IST
-- ---------------------------------------------------------------------
create or replace function withdrawal_window_open()
returns boolean
language sql stable
as $$
  select (now() at time zone 'Asia/Kolkata')::time >= time '10:00'
     and (now() at time zone 'Asia/Kolkata')::time <  time '17:00';
$$;

-- ---------------------------------------------------------------------
-- Withdrawal request: time window, then stop the recurring bonus
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

  if not withdrawal_window_open() then
    raise exception 'Withdrawals are open only from 10:00 AM to 5:00 PM IST.';
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
-- Reject: a rejected withdrawal gives the user their running bonus back
-- ---------------------------------------------------------------------
create or replace function reject_transaction(transaction_id uuid)
returns void as $$
declare
  v_rejected uuid;
begin
  update public.transactions t
    set status = 'rejected'
    where t.id = reject_transaction.transaction_id and t.status = 'pending'
    returning t.id into v_rejected;

  if v_rejected is not null then
    -- mature_at was left untouched, so the next settlement catches up on
    -- the cycles missed while the withdrawal was pending
    update public.slot_commissions
      set credited_at = null,
          stopped_by = null
      where stopped_by = v_rejected;
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Wallet summary: also report the withdrawal window
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

  -- pending = what the running deposits pay out every 24 hours
  select coalesce(sum(amount), 0), min(mature_at), coalesce(sum(slot_amount), 0)
    into v_pending, v_next, v_running
    from public.slot_commissions
    where user_id = v_user_id and credited_at is null;

  v_unlock_at := withdrawal_unlock_at(v_user_id);

  return json_build_object(
    'balance', coalesce(v_profile.balance, 0),
    'locked_balance', coalesce(v_profile.locked_balance, 0),
    'withdrawable', greatest(coalesce(v_profile.balance, 0) - coalesce(v_profile.locked_balance, 0), 0),
    'pending_commission', v_pending,
    'next_commission_at', v_next,
    'bonus_running_amount', v_running,
    'payout_upi', v_profile.payout_upi,
    'withdraw_unlock_at', case when v_unlock_at > now() then v_unlock_at end,
    'withdrawals_today', withdrawals_today(v_user_id),
    'withdrawal_daily_limit', 3,
    'withdraw_window_open', withdrawal_window_open()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Today's earnings: every slot commission is now written with the time
-- it was due, so all commissions can be counted the same way.
-- ---------------------------------------------------------------------
create or replace function today_earnings_for(target_user_id uuid)
returns decimal
language sql stable security definer
as $$
  select coalesce(sum(t.amount), 0)
  from public.transactions t
  where t.user_id = target_user_id
    and t.type = 'commission'
    and t.created_at >= ist_day_start()
    and t.created_at <= now();
$$;
