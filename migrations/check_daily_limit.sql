-- RPC to get the count of tools added by a user today (IST Timezone)
create or replace function get_daily_tool_count(target_user_id uuid)
returns integer as $$
declare
    tool_count integer;
begin
    select count(*)
    into tool_count
    from public.user_tools
    where user_id = target_user_id
      -- Convert created_at (UTC) to IST date and compare with current IST Date
      and (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date;
      
    return tool_count;
end;
$$ language plpgsql security definer;
