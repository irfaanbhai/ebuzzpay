-- RPC to fetch transactions with Search (No Pagination) - DEPOSITS ONLY
-- Updated to include currency and chain

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
        t.type = 'deposit' AND
        (search_query IS NULL OR 
         t.utr ILIKE '%' || search_query || '%' OR
         t.user_id::text ILIKE '%' || search_query || '%' OR
         p.email ILIKE '%' || search_query || '%')
    ORDER BY 
        t.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
