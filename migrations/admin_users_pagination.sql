-- RPC to fetch users with extended details (earnings, tools) with Pagination and Search
-- Sorts by Balance DESC (High to Low), then Recent Users
DROP FUNCTION IF EXISTS get_admin_users_extended();
DROP FUNCTION IF EXISTS get_admin_users_extended(text, int, int);

CREATE OR REPLACE FUNCTION get_admin_users_extended(
  search_query text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  email text,
  balance decimal(12, 2),
  is_banned boolean,
  created_at timestamp with time zone,
  today_earnings decimal,
  tools jsonb
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.balance,
    COALESCE(p.is_banned, false) as is_banned,
    p.created_at,
    COALESCE((
      SELECT SUM(t.amount)
      FROM public.transactions t
      WHERE t.user_id = p.id
        AND t.type = 'commission'
        AND t.created_at >= CURRENT_DATE
    ), 0) AS today_earnings,
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
     p.id::text ILIKE '%' || search_query || '%')
  ORDER BY 
    p.balance DESC NULLS LAST, 
    p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
