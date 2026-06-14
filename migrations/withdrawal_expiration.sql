-- RPC to expire old withdrawals
-- Targets withdrawals created > 5 minutes ago that are 'approved' (which currently renders as Paying) or 'pending'
-- Sets them to 'expired'.

create or replace function check_and_expire_withdrawals()
returns void as $$
begin
    update public.transactions
    set status = 'expired'
    where type = 'withdrawal' 
      and status in ('approved', 'pending') 
      and created_at < (now() - interval '5 minutes');
end;
$$ language plpgsql security definer;
