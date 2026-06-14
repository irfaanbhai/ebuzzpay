-- Redefine get_all_transactions to include user email
DROP FUNCTION IF EXISTS get_all_transactions();

CREATE OR REPLACE FUNCTION get_all_transactions()
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
    email text
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
        p.email
    FROM 
        public.transactions t
    LEFT JOIN 
        public.profiles p ON t.user_id = p.id
    ORDER BY 
        t.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
