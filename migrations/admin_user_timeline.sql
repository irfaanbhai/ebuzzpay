-- =====================================================================
-- Admin: bonus timer, deposit / withdrawal times per user
-- ---------------------------------------------------------------------
-- Run this AFTER wallet_balance_bonus.sql - it redefines
-- get_admin_users_extended() and adds get_admin_user_history().
--
--   * transactions.processed_at: when the admin approved / rejected it,
--     filled by a trigger on any status change. Old deposits are
--     backfilled from their approval record; old withdrawals stay empty.
--   * Users list now returns the bonus timer and the latest deposit and
--     withdrawal with their times.
--   * get_admin_user_history(): one user's full money timeline.
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_name = 'transactions' and column_name = 'processed_at') then
        alter table public.transactions add column processed_at timestamptz;
    end if;
end $$;

create or replace function set_transaction_processed_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Commissions are written already approved
    if new.status <> 'pending' and new.processed_at is null then
      new.processed_at := coalesce(new.created_at, now());
    end if;
  elsif new.status is distinct from old.status and old.status = 'pending' then
    new.processed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_processed_at on public.transactions;
create trigger transactions_processed_at
  before insert or update of status on public.transactions
  for each row execute function set_transaction_processed_at();

-- Deposits approved before this: the approval record has the time
update public.transactions t
  set processed_at = sc.created_at
  from public.slot_commissions sc
  where sc.transaction_id = t.id
    and t.processed_at is null;

-- Commissions are created already approved
update public.transactions
  set processed_at = created_at
  where type = 'commission' and processed_at is null;

-- ---------------------------------------------------------------------
-- Users list: + bonus timer, latest deposit and withdrawal
-- (return type changes, so drop first)
-- ---------------------------------------------------------------------
drop function if exists get_admin_users_extended(text, int, int);

create function get_admin_users_extended(
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
  tools jsonb,
  bonus_next_at timestamptz,
  bonus_base numeric,
  bonus_next_payout numeric,
  last_deposit jsonb,
  last_withdrawal jsonb
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
    ), '[]'::jsonb) AS tools,
    p.bonus_next_at,
    (bc->>'base')::numeric AS bonus_base,
    (bc->>'payout')::numeric AS bonus_next_payout,
    (
      SELECT jsonb_build_object(
        'amount', coalesce(t.converted_amount, t.amount),
        'status', t.status,
        'requested_at', t.created_at,
        'processed_at', t.processed_at
      )
      FROM public.transactions t
      WHERE t.user_id = p.id AND t.type = 'deposit'
      ORDER BY t.created_at DESC
      LIMIT 1
    ) AS last_deposit,
    (
      SELECT jsonb_build_object(
        'amount', t.amount,
        'status', t.status,
        'requested_at', t.created_at,
        'processed_at', t.processed_at
      )
      FROM public.transactions t
      WHERE t.user_id = p.id AND t.type = 'withdrawal' AND t.tool_id IS NULL
      ORDER BY t.created_at DESC
      LIMIT 1
    ) AS last_withdrawal
  FROM public.profiles p
  CROSS JOIN LATERAL bonus_cycle_for(p.id) AS bc
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

-- ---------------------------------------------------------------------
-- One user's deposits, withdrawals and commissions, newest first.
-- Simulated tool payouts (tool_id set) are left out: they never touch
-- the wallet.
-- ---------------------------------------------------------------------
create or replace function get_admin_user_history(target_user_id uuid, p_limit int default 200)
returns table (
  id uuid,
  type text,
  amount numeric,
  status text,
  payment_method text,
  upi_id text,
  utr text,
  requested_at timestamptz,
  processed_at timestamptz
)
language sql stable security definer
as $$
  select t.id, t.type, coalesce(t.converted_amount, t.amount), t.status,
         t.payment_method, t.upi_id, t.utr, t.created_at, t.processed_at
  from public.transactions t
  where t.user_id = target_user_id
    and t.tool_id is null
  order by t.created_at desc
  limit p_limit;
$$;
