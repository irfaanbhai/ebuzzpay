-- Function to get all profiles (for admin)
create or replace function get_all_profiles()
returns table (
  id uuid,
  email text,
  balance decimal(12, 2),
  created_at timestamp with time zone
) 
language plpgsql security definer
as $$
begin
  return query select p.id, p.email, p.balance, p.created_at from public.profiles p order by p.created_at desc;
end;
$$;

-- Function to update user balance (for admin)
create or replace function admin_update_balance(user_id uuid, new_balance decimal)
returns void
language plpgsql security definer
as $$
begin
  update public.profiles
  set balance = new_balance
  where id = user_id;
end;
$$;

-- Function to get all tools (for admin)
create or replace function get_all_tools()
returns table (
  tool_id uuid,
  user_email text,
  upi_id text,
  status text,
  created_at timestamp with time zone
)
language plpgsql security definer
as $$
begin
  return query 
  select t.id, p.email, t.upi_id, t.status, t.created_at
  from public.user_tools t
  join public.profiles p on t.user_id = p.id
  order by t.created_at desc;
end;
$$;
