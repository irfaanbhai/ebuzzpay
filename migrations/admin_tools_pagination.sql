-- RPC to fetch tools with Pagination and Search
DROP FUNCTION IF EXISTS get_all_tools();

CREATE OR REPLACE FUNCTION get_all_tools(
  search_query text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS setof public.user_tools AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM public.user_tools ut
    WHERE
        (search_query IS NULL OR 
         ut.upi_id ILIKE '%' || search_query || '%' OR
         ut.name ILIKE '%' || search_query || '%' OR
         ut.user_id::text ILIKE '%' || search_query || '%')
    ORDER BY ut.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
