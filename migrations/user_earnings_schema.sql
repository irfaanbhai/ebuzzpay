-- RPC to calculate today's earnings (commissions)
create or replace function get_today_earnings(target_user_id uuid)
returns decimal as $$
declare
    total_earnings decimal;
begin
    select coalesce(sum(amount), 0)
    into total_earnings
    from public.transactions
    where user_id = target_user_id
      and type = 'commission'
      and created_at >= current_date; -- timestamp comparison works for 'today'
      
    return total_earnings;
end;
$$ language plpgsql security definer;
