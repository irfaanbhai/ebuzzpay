-- =====================================================================
-- Rejected withdrawals go back to the wallet + times on the admin
-- transactions tab
-- ---------------------------------------------------------------------
-- Run this AFTER admin_user_timeline.sql (needs processed_at). It
-- redefines reject_transaction() and get_all_transactions().
--
--   * reject_transaction() is the version that returns a held
--     withdrawal to the wallet. Running an older migration again
--     (recurring_deposit_bonus.sql, commission_and_referral_rules.sql...)
--     replaces it with one that does not refund - this puts it back.
--   * transactions.refunded_at records when the money went back, so the
--     admin can see it, and a withdrawal can never be refunded twice.
--   * get_all_transactions() also returns processed_at, balance_held and
--     refunded_at.
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_name = 'transactions' and column_name = 'refunded_at') then
        alter table public.transactions add column refunded_at timestamptz;
    end if;
end $$;

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

  -- Only a withdrawal that took the money out on request (balance_held)
  -- gives it back; older requests never left the wallet
  if v_rejected is not null and v_type = 'withdrawal' and v_held then
    perform release_due_slot_commissions(v_user);

    update public.profiles
      set balance = balance + v_amount,
          -- the withdrawal had emptied the wallet: start a fresh 24 hours
          bonus_next_at = case
            when bonus_next_at is null and balance + v_amount > 0
              then now() + interval '24 hours'
            else bonus_next_at
          end
      where id = v_user;

    update public.transactions
      set refunded_at = now()
      where id = v_rejected;
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Admin transactions list: + processed / refund times
-- (return type changes, so drop first)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_all_transactions(text);

CREATE FUNCTION get_all_transactions(
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
    usdt_amount numeric,
    processed_at timestamptz,
    balance_held boolean,
    refunded_at timestamptz
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
        t.usdt_amount,
        t.processed_at,
        coalesce(t.balance_held, false) as balance_held,
        t.refunded_at
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
