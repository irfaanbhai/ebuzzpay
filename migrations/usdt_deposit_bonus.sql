-- =====================================================================
-- USDT deposit bonus (flat INR bonus per 1 USDT)
-- ---------------------------------------------------------------------
-- Run this AFTER commission_and_referral_rules.sql - it redefines
-- approve_transaction() on top of that version.
--
--   Pay 1 USDT at a rate of 107  ->  amount       = 107.00 INR
--                                    bonus_amount =   3.00 INR
--                                    credited     = 110.00 INR
--
-- The paid part (amount) counts as a slot purchase: it releases locked
-- balance, earns the 5% slot commission and pays the referrer.
-- The bonus part is credited as LOCKED money - it has to be put on a
-- slot before it can be withdrawn, like every other bonus.
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_name = 'transactions' and column_name = 'bonus_amount') then
        alter table public.transactions add column bonus_amount numeric(12, 2) default 0;
    end if;

    if not exists (select 1 from information_schema.columns
                   where table_name = 'transactions' and column_name = 'usdt_amount') then
        alter table public.transactions add column usdt_amount numeric(18, 6);
    end if;
end $$;

-- Admin-tunable bonus, in INR per 1 USDT
insert into public.admin_settings (key, value)
values ('usdt_bonus_per_unit', '3')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Approve: credit paid amount + bonus, but only the paid amount counts
-- as money actually placed on a slot.
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

  -- For deposits, credit the converted amount if present (USDT), else amount.
  final_amount := coalesce(txn.converted_amount, txn.amount);
  bonus := coalesce(txn.bonus_amount, 0);

  if txn.type = 'deposit' then
    update public.profiles
      set balance = balance + final_amount + bonus,
          -- the paid amount was put on a slot, so it releases that much of
          -- the lock; the bonus arrives locked and adds to it
          locked_balance = greatest(0, coalesce(locked_balance, 0) - final_amount) + bonus
      where id = txn.user_id;

    -- 5% slot commission on the paid amount, payable 24 hours from now
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
-- Admin panel: surface the USDT amount and the bonus on each row
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_all_transactions();
DROP FUNCTION IF EXISTS get_all_transactions(text);

CREATE OR REPLACE FUNCTION get_all_transactions(
  search_query text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    amount decimal,
    type text,
    status text,
    created_at timestamptz,
    utr text,
    payment_method text,
    tool_id uuid,
    email text,
    currency text,
    chain text,
    upi_id text,
    bonus_amount numeric,
    usdt_amount numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.user_id,
        t.amount,
        t.type,
        t.status,
        t.created_at,
        t.utr,
        t.payment_method,
        t.tool_id,
        p.email,
        t.currency,
        t.chain,
        -- deposits show the UPI actually recorded on the payment; for a
        -- withdrawal fall back to the account's registered payout UPI
        case when t.type = 'withdrawal' then coalesce(t.upi_id, p.payout_upi)
             else t.upi_id end as upi_id,
        coalesce(t.bonus_amount, 0) as bonus_amount,
        t.usdt_amount
    FROM
        public.transactions t
    LEFT JOIN
        public.profiles p ON t.user_id = p.id
    WHERE
        t.type IN ('deposit', 'withdrawal') AND
        (search_query IS NULL OR
         t.utr ILIKE '%' || search_query || '%' OR
         t.upi_id ILIKE '%' || search_query || '%' OR
         t.user_id::text ILIKE '%' || search_query || '%' OR
         p.email ILIKE '%' || search_query || '%')
    ORDER BY
        -- pending requests first so the admin sees actionable items on top
        (t.status = 'pending') DESC,
        t.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
