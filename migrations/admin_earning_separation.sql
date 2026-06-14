-- Update Admin Add Earning to ONLY update commission stats, NOT balance
drop function if exists admin_add_earning(uuid, decimal, uuid);

create or replace function admin_add_earning(target_user_id uuid, amount decimal, target_tool_id uuid default null)
returns void as $$
begin
    -- 1. Update total_commission (stats) but NOT the main wallet balance
    update public.profiles 
    set total_commission = total_commission + amount 
    where id = target_user_id;
    
    -- 2. Record transaction (So it appears in "Today's Earning" via get_today_earnings)
    insert into public.transactions (user_id, tool_id, amount, type, status, payment_method, utr)
    values (target_user_id, target_tool_id, amount, 'commission', 'approved', 'system_add', 'bonus_' || floor(extract(epoch from now())));
end;
$$ language plpgsql security definer;
