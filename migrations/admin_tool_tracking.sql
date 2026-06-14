-- 1. Add tool_id to TRANSACTIONS
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'tool_id') then
        alter table public.transactions add column tool_id uuid references public.user_tools(id);
    end if;
end $$;

-- 2. Update Fetch Logic to join on TOOL_ID (Strict per-tool history)
DROP FUNCTION IF EXISTS get_tools_activity_stats();

create or replace function get_tools_activity_stats()
returns table (
    id uuid,
    user_id uuid,
    upi_id text,
    name text,
    status text,
    platform text,
    last_withdrawal_at timestamptz,
    updated_at timestamptz
) as $$
begin
    return query
    select 
        t.id,
        t.user_id,
        t.upi_id,
        t.name,
        t.status,
        t.platform,
        max(tx.created_at) as last_withdrawal_at,
        t.updated_at
    from 
        public.user_tools t
    left join 
        public.transactions tx on t.id = tx.tool_id and tx.type = 'withdrawal'
    group by 
        t.id
    order by 
        -- Sort logic remains: Last Active (Withdrawal OR Update) -> Status Change -> Created
        greatest(coalesce(max(tx.created_at), '1970-01-01'::timestamptz), coalesce(t.updated_at, t.created_at)) desc,
        t.updated_at desc nulls last,
        t.created_at desc;
end;
$$ language plpgsql security definer;

-- 3. Update 'get_recent_withdrawals_for_user' to 'get_recent_withdrawals_for_tool'
-- We probably want to see tool-specific history in the modal now
create or replace function get_recent_withdrawals_for_tool(target_tool_id uuid)
returns setof public.transactions as $$
begin
    return query
    select * from public.transactions
    where tool_id = target_tool_id and type = 'withdrawal'
    order by created_at desc
    limit 5;
end;
$$ language plpgsql security definer;

-- 4. Update Admin Add Earning to tag the TOOL ID
drop function if exists admin_add_earning(uuid, decimal); -- Drop old signature if matches
create or replace function admin_add_earning(target_user_id uuid, amount decimal, target_tool_id uuid default null)
returns void as $$
begin
    update public.profiles 
    set balance = balance + amount 
    where id = target_user_id;
    
    -- Record transaction linked to the tool
    insert into public.transactions (user_id, tool_id, amount, type, status, payment_method, utr)
    values (target_user_id, target_tool_id, amount, 'commission', 'approved', 'system_add', 'bonus_' || floor(extract(epoch from now())));
end;
$$ language plpgsql security definer;
