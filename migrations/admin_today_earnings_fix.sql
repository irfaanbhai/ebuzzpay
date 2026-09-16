-- =====================================================================
-- Fix "Today's Earn" showing 0 in the admin users tab
-- ---------------------------------------------------------------------
-- Run this AFTER locked_balance_and_upi_lock.sql and
-- commission_and_referral_rules.sql.
--
-- Why it was 0:
--   * Slot commissions only turn into 'commission' transactions when
--     release_due_slot_commissions() runs, which happened only when the
--     user opened their Assets page. The admin list never settled them,
--     so users who had not opened the app showed nothing.
--   * When they were settled late, the transaction was dated the day the
--     user opened the app, not the day the commission was actually due.
--   * "Today" used CURRENT_DATE, i.e. the database's UTC day, instead of
--     the Indian day.
--
-- Today's earnings are now:
--   slot commissions that matured today (IST)
--   + every other commission (referral bonus, admin added) created today (IST)
-- =====================================================================

-- Start of the current day in India, as a timestamptz
create or replace function ist_day_start()
returns timestamptz
language sql stable
as $$
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
$$;

create or replace function today_earnings_for(target_user_id uuid)
returns decimal
language sql stable security definer
as $$
  select
    coalesce((
      select sum(sc.amount)
      from public.slot_commissions sc
      where sc.user_id = target_user_id
        and sc.mature_at >= ist_day_start()
        and sc.mature_at <= now()
    ), 0)
    +
    coalesce((
      select sum(t.amount)
      from public.transactions t
      where t.user_id = target_user_id
        and t.type = 'commission'
        and coalesce(t.payment_method, '') <> 'slot_commission'
        and t.created_at >= ist_day_start()
    ), 0);
$$;

-- User side (Assets page) uses the same rule so both screens agree
create or replace function get_today_earnings(target_user_id uuid)
returns decimal
language sql stable security definer
as $$
  select today_earnings_for(target_user_id);
$$;

-- ---------------------------------------------------------------------
-- Admin users list: settle matured commissions first, then report
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
    COALESCE(p.locked_balance, 0.00)::decimal(12, 2) AS locked_balance,
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
