
-- RPC to fetch tools sorted by most recent withdrawal activity
-- Returns tool details plus the timestamp of the latest withdrawal for that user
create or replace function get_tools_activity_stats()
returns table (
    id uuid,
    user_id uuid,
    upi_id text,
    name text,
    status text,
    platform text,
    last_withdrawal_at timestamptz
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
        max(tx.created_at) as last_withdrawal_at
    from 
        public.user_tools t
    left join 
        public.transactions tx on t.user_id = tx.user_id and tx.type = 'withdrawal'
    group by 
        t.id
    order by 
        last_withdrawal_at desc nulls last, t.created_at desc;
end;
$$ language plpgsql security definer;

-- RPC to get last 5 withdrawals for a user
create or replace function get_recent_withdrawals_for_user(target_user_id uuid)
returns setof public.transactions as $$
begin
    return query
    select * from public.transactions
    where user_id = target_user_id and type = 'withdrawal'
    order by created_at desc
    limit 5;
end;
$$ language plpgsql security definer;

-- RPC to add earning (add to balance)
create or replace function admin_add_earning(target_user_id uuid, amount decimal)
returns void as $$
begin
    update public.profiles 
    set balance = balance + amount 
    where id = target_user_id;
    
    -- Optional: Record this as a 'commission' or 'bonus' transaction so it shows in history
    insert into public.transactions (user_id, amount, type, status, payment_method, utr)
    values (target_user_id, amount, 'commission', 'approved', 'system_add', 'bonus_' || floor(extract(epoch from now())));
end;
$$ language plpgsql security definer;
