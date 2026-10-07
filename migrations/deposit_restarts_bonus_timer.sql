-- =====================================================================
-- A deposit restarts the 5% bonus timer
-- ---------------------------------------------------------------------
-- Run this AFTER withdrawal_refund_and_txn_times.sql - it redefines
-- release_due_slot_commissions(), approve_transaction() and
-- bonus_cycle_for() from wallet_balance_bonus.sql.
--
-- Rules:
--   * Every approved deposit restarts the 24 hour timer. When it ends the
--     user gets 5% of the whole wallet, that deposit included.
--       e.g. wallet 220 (bonus), deposits 5000 -> timer restarts,
--            24h later 5% of 5220 = 261
--   * Until those 24 hours pass the deposit is locked (INR 24h lock), so
--     only the 220 can be withdrawn.
--   * A withdrawal never stops or resets the timer, it only lowers the
--     amount: withdraw 100 of the 220 -> 24h later 5% of 5120 = 256
--   * The timer stops only when the wallet reaches 0.
-- =====================================================================

-- Users who deposited in the last 48 hours: move their timer onto that
-- deposit's 24 hour rhythm (next slot still ahead), as if this rule had
-- been live already. Payouts that slot would have made in the past are
-- not paid here.
update public.profiles p
  set bonus_next_at = d.last_approved
        + interval '24 hours' * greatest(1, ceil(extract(epoch from (now() - d.last_approved)) / 86400))
  from (
    select user_id, max(created_at) as last_approved
    from public.slot_commissions
    group by user_id
  ) d
  where d.user_id = p.id
    and p.bonus_next_at is not null
    and d.last_approved > now() - interval '48 hours';

-- ---------------------------------------------------------------------
-- Pay every 24 hour cycle that has come due: 5% of the wallet
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

      -- every deposit restarts the timer, so all of it has had 24 hours
      v_base := v_balance;
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
-- Approve: a deposit restarts the timer
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
          -- every deposit restarts the 24 hours
          bonus_next_at = now() + interval '24 hours'
      where id = txn.user_id;

    -- Approval record: the INR 24h lock reads created_at. credited_at is filled so the old
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
-- Next payout: 5% of the whole wallet
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
    select greatest(coalesce(p.balance, 0), 0) as base
  ) b
  where p.id = target_user_id;
$$;
