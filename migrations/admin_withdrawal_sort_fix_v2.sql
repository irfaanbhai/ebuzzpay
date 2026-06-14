-- 1. Add updated_at column to user_tools (Idempotent)
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'user_tools' and column_name = 'updated_at') then
        alter table public.user_tools add column updated_at timestamptz default now();
    end if;
end $$;

-- 2. Create Trigger to automatically update 'updated_at' on any change
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists on_user_tools_updated on public.user_tools;
create trigger on_user_tools_updated
    before update on public.user_tools
    for each row execute procedure public.handle_updated_at();

-- 3. Update status change functions (The trigger now handles updated_at, but keeping explicit set is fine too)
-- We can simplify them or leave them. Let's leave them to be safe/explicit.
create or replace function verify_tool(tool_id uuid)
returns void as $$
begin
    update public.user_tools 
    set status = 'stopped'
    -- updated_at will be set by trigger
    where id = tool_id;
end;
$$ language plpgsql security definer;

create or replace function reject_tool(tool_id uuid)
returns void as $$
begin
    update public.user_tools 
    set status = 'rejected'
    where id = tool_id;
end;
$$ language plpgsql security definer;

-- 4. Update the fetch function with TIE-BREAKER
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
        -- Primary Sort: The latest relevant event (withdrawal OR update)
        greatest(coalesce(max(tx.created_at), '1970-01-01'::timestamptz), coalesce(t.updated_at, t.created_at)) desc,
        -- Secondary Sort (Tie-Breaker): If Primary Sort is identical (e.g. same user withdrawal),
        -- prioritize the tool that was explicitly modified most recently.
        t.updated_at desc nulls last,
        -- Final fallbacks
        t.created_at desc;
end;
$$ language plpgsql security definer;
