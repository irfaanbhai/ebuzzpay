-- Create a function to fetch all transactions (bypassing RLS for admin)
create or replace function get_all_transactions()
returns setof public.transactions as $$
begin
  return query select * from public.transactions order by created_at desc;
end;
$$ language plpgsql security definer;
