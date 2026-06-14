-- Backfill tool_id for existing withdrawals
-- Logic: Assign each orphan withdrawal to the User's most recently created tool.
-- This ensures 'Last Active' and 'History' show up for existing data.

UPDATE public.transactions t
SET tool_id = (
    SELECT id 
    FROM public.user_tools ut 
    WHERE ut.user_id = t.user_id 
    ORDER BY created_at DESC 
    LIMIT 1
)
WHERE t.tool_id IS NULL 
  AND t.type = 'withdrawal';
