-- =====================================================================
-- Withdrawal Approve / Reject system for the Admin panel
-- ---------------------------------------------------------------------
-- Problem:
--   1) get_all_transactions() only returned rows where type = 'deposit',
--      so withdrawal requests created from the Assets page never showed
--      up in the admin "Transactions" tab.
--   2) approve_transaction() did nothing for withdrawals, assuming the
--      balance was already deducted at request time. The app does NOT
--      deduct at request time, so approving never moved any money.
--
-- Fix:
--   * get_all_transactions() now returns deposits AND withdrawals.
--   * approve_transaction() deducts the user balance when a withdrawal
--     is approved (with an insufficient-balance guard).
--   * reject_transaction() leaves the balance untouched (nothing was
--     held), it only marks the request rejected.
-- =====================================================================

-- Make sure the optional cross-currency column exists so the approve
-- logic below can safely reference it.
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'converted_amount') then
        alter table public.transactions add column converted_amount numeric;
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'currency') then
        alter table public.transactions add column currency text default 'INR';
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'chain') then
        alter table public.transactions add column chain text;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Return both deposits and withdrawals to the admin panel
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
    chain text
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
        t.chain
    FROM
        public.transactions t
    LEFT JOIN
        public.profiles p ON t.user_id = p.id
    WHERE
        t.type IN ('deposit', 'withdrawal') AND
        (search_query IS NULL OR
         t.utr ILIKE '%' || search_query || '%' OR
         t.user_id::text ILIKE '%' || search_query || '%' OR
         p.email ILIKE '%' || search_query || '%')
    ORDER BY
        -- pending requests first so the admin sees actionable items on top
        (t.status = 'pending') DESC,
        t.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- 2. Approve: credit deposits, debit withdrawals
-- ---------------------------------------------------------------------
create or replace function approve_transaction(transaction_id uuid)
returns void as $$
declare
  txn record;
  final_amount numeric;
  current_balance numeric;
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
      set balance = balance + final_amount
      where id = txn.user_id;

  elsif txn.type = 'withdrawal' then
    -- Balance is held until approval, so deduct it now.
    select balance into current_balance from public.profiles where id = txn.user_id;
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
-- 3. Reject: just mark rejected (no funds were held)
-- ---------------------------------------------------------------------
create or replace function reject_transaction(transaction_id uuid)
returns void as $$
begin
  update public.transactions
    set status = 'rejected'
    where id = transaction_id and status = 'pending';
end;
$$ language plpgsql security definer;
