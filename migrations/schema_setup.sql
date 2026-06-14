-- Create profiles table to store user balance
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  balance decimal(12, 2) default 0.00,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on profiles
alter table public.profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Create a trigger to automatically create profile on signup
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, email, balance)
  values (new.id, new.email, 0.00);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Create transactions table
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  amount decimal(12, 2) not null,
  utr text not null,
  status text check (status in ('pending', 'approved', 'rejected')) default 'pending',
  payment_method text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on transactions
alter table public.transactions enable row level security;
create policy "Users can view own transactions" on transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on transactions for insert with check (auth.uid() = user_id);

-- Function to approve transaction and update balance (Secure Transaction)
create or replace function approve_transaction(transaction_id uuid)
returns void as $$
declare
  txn_amount decimal(12, 2);
  txn_user_id uuid;
  current_status text;
begin
  -- Get transaction details
  select amount, user_id, status into txn_amount, txn_user_id, current_status
  from public.transactions
  where id = transaction_id;

  if current_status = 'pending' then
    -- Update transaction status
    update public.transactions 
    set status = 'approved' 
    where id = transaction_id;

    -- Update user balance
    update public.profiles 
    set balance = balance + txn_amount 
    where id = txn_user_id;
  end if;
end;
$$ language plpgsql security definer;
