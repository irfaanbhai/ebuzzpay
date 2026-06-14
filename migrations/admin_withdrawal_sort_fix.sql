-- 1. Add updated_at column to user_tools
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'user_tools' and column_name = 'updated_at') then
        alter table public.user_tools add column updated_at timestamptz default now();
    end if;
end $$;

-- 2. Update status change functions to set updated_at
create or replace function verify_tool(tool_id uuid)
returns void as $$
begin
    update public.user_tools 
    set status = 'stopped', updated_at = now() 
    where id = tool_id;
end;
$$ language plpgsql security definer;

create or replace function reject_tool(tool_id uuid)
returns void as $$
begin
    update public.user_tools 
    set status = 'rejected', updated_at = now() 
    where id = tool_id;
end;
$$ language plpgsql security definer;

-- 3. Update the fetch function to sort by GREATEST(last_withdrawal, updated_at)
-- DROP first because return type signature is changing
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
        public.transactions tx on t.user_id = tx.user_id and tx.type = 'withdrawal'
    group by 
        t.id
    order by 
        -- Sort by whichever is more recent: the last withdrawal OR the last tool update (status change)
        greatest(coalesce(max(tx.created_at), '1970-01-01'::timestamptz), coalesce(t.updated_at, t.created_at)) desc;
end;
$$ language plpgsql security definer;
