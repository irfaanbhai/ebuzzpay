-- COMPLETE SUPABASE SETUP FOR UPI PROJECT
-- Run this file in the Supabase SQL Editor to set up the entire database.

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- 2. TABLES

-- 2.1 PROFILES (Users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  balance decimal(12, 2) default 0.00,
  referral_code text unique,
  referrer_id uuid references public.profiles(id),
  total_commission decimal(12,2) default 0.00,
  is_banned boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.2 ADMIN SETTINGS
create table if not exists public.admin_settings (
    key text primary key,
    value text
);

-- 2.3 USER TOOLS
create table if not exists public.user_tools (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  upi_id text not null,
  name text,
  phone_number text,
  status text default 'running', -- running, stopped, rejected
  platform text default 'upi',
  updated_at timestamptz default now(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.4 TRANSACTIONS
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  tool_id uuid references public.user_tools(id), -- Optional link to specific tool
  amount decimal(12, 2) not null,
  type text default 'deposit', -- deposit, withdrawal, commission
  utr text not null,
  status text check (status in ('pending', 'approved', 'rejected')) default 'pending',
  payment_method text,
  currency text default 'INR', -- INR, USDT
  chain text, -- TRC20, BEP20 (for USDT)
  crypto_address text, -- User's wallet address
  withdrawal_details jsonb, -- For withdrawal bank details
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. ENABLE ROW LEVEL SECURITY (RLS)

alter table public.profiles enable row level security;
alter table public.admin_settings enable row level security;
alter table public.user_tools enable row level security;
alter table public.transactions enable row level security;

-- 4. POLICIES

-- Profiles
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
create policy "Users can update own profile." on public.profiles for update using (auth.uid() = id);

-- Admin Settings
create policy "Enable read access for all users" on public.admin_settings for select using (true);
create policy "Enable update for authenticated users only" on public.admin_settings for update using (auth.role() = 'authenticated'); 

-- User Tools
create policy "Users can view own tools" on public.user_tools for select using (auth.uid() = user_id);
create policy "Users can update own tools" on public.user_tools for update using (auth.uid() = user_id);
create policy "Users can insert own tools" on public.user_tools for insert with check (auth.uid() = user_id);
create policy "Users can delete own tools" on public.user_tools for delete using (auth.uid() = user_id);

-- Transactions
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions for insert with check (auth.uid() = user_id);

-- 5. DATA SEEDING

-- Initial Admin Settings
INSERT INTO public.admin_settings (key, value)
VALUES 
    ('admin_upi', 'mahawar-akash@ptyes'),
    ('maintenance_mode', 'false'),
    ('maintenance_heading', 'Under Maintenance'),
    ('maintenance_description', 'We are currently performing scheduled maintenance. Please check back soon.')
ON CONFLICT (key) DO NOTHING;

-- 6. TRIGGERS & HELPERS

-- 6.1 Handle New User (Profile Creation + Referrals)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  referrer_code_input text;
  referrer_id_lookup uuid;
BEGIN
  -- Extract referral code from user metadata
  referrer_code_input := new.raw_user_meta_data->>'referrer_code';

  -- If provided, try to find the referrer
  IF referrer_code_input IS NOT NULL THEN
    SELECT id INTO referrer_id_lookup FROM public.profiles WHERE referral_code = referrer_code_input;
  END IF;

  INSERT INTO public.profiles (
    id, 
    email, 
    balance,
    referral_code, 
    referrer_id
  )
  VALUES (
    new.id, 
    new.email, 
    0.00,
    substring(md5(random()::text) from 1 for 8),
    referrer_id_lookup
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 6.2 Handle Updated At (Auto-update timestamp)
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

-- 7. FUNCTIONS (RPCs)

-- 7.1 Admin: Get All Profiles (Plain)
create or replace function get_all_profiles()
returns setof public.profiles as $$
begin
  return query select * from public.profiles order by created_at desc;
end;
$$ language plpgsql security definer;

-- 7.2 Admin: Approve Transaction
create or replace function approve_transaction(transaction_id uuid)
returns void as $$
declare
  txn record;
begin
  -- Get transaction
  select * into txn from public.transactions where id = transaction_id;
  
  if txn.status = 'approved' then
    return; -- Already approved
  end if;

  -- Update transaction status
  update public.transactions set status = 'approved' where id = transaction_id;

  -- Update user balance
  if txn.type = 'deposit' then
    update public.profiles set balance = balance + txn.amount where id = txn.user_id;
  elsif txn.type = 'withdrawal' then
    -- Typically withdrawals are deducted when requested. If rejected, refunded.
    -- If we approve a withdrawal, balance is already gone, so do nothing (just status update).
    null; 
  end if;
end;
$$ language plpgsql security definer;

-- 7.3 Admin: Reject Transaction
create or replace function reject_transaction(transaction_id uuid)
returns void as $$
begin
  update public.transactions set status = 'rejected' where id = transaction_id;
end;
$$ language plpgsql security definer;

-- 7.4 Admin: Update Balance Direct
create or replace function admin_update_balance(user_id uuid, new_balance decimal)
returns void as $$
begin
  update public.profiles set balance = new_balance where id = user_id;
end;
$$ language plpgsql security definer;

-- 7.5 Team Stats
create or replace function get_team_stats(query_user_id uuid)
returns json as $$
declare
  total_comm decimal;
  comm_today decimal;
  comm_yest decimal;
  team_cnt int;
  team_cnt_b int;
  team_cnt_c int;
  new_team_cnt int;
begin
  select total_commission into total_comm from public.profiles where id = query_user_id;
  
  comm_today := 0; 
  comm_yest := 0;

  -- Level A (Direct)
  select count(*) into team_cnt from public.profiles where referrer_id = query_user_id;
  
  -- Level B (Indirect L2)
  select count(*) into team_cnt_b from public.profiles where referrer_id in (
    select id from public.profiles where referrer_id = query_user_id
  );

  -- Level C (Indirect L3)
  select count(*) into team_cnt_c from public.profiles where referrer_id in (
    select id from public.profiles where referrer_id in (
      select id from public.profiles where referrer_id = query_user_id
    )
  );
  
  -- New Team (joined last 24h)
  select count(*) into new_team_cnt from public.profiles where referrer_id = query_user_id and created_at > now() - interval '24 hours';

  return json_build_object(
    'total_commission', coalesce(total_comm, 0),
    'commission_today', comm_today,
    'commission_yesterday', comm_yest,
    'team_count', team_cnt,
    'level_b_count', team_cnt_b,
    'level_c_count', team_cnt_c,
    'today_new_team', new_team_cnt
  );
end;
$$ language plpgsql security definer;

-- 7.6 Admin: Get All Transactions (Search + USDT Support)
CREATE OR REPLACE FUNCTION get_all_transactions(
  search_query text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    amount decimal,
    type text,
    status text,
    created_at timestamptz,
    utr text,
    payment_method text,
    tool_id uuid,
    email text,
    currency text,
    chain text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.user_id,
        t.amount,
        t.type,
        t.status,
        t.created_at,
        t.utr,
        t.payment_method,
        t.tool_id,
        p.email,
        t.currency,
        t.chain
    FROM 
        public.transactions t
    LEFT JOIN 
        public.profiles p ON t.user_id = p.id
    WHERE
        t.type = 'deposit' AND
        (search_query IS NULL OR 
         t.utr ILIKE '%' || search_query || '%' OR
         t.user_id::text ILIKE '%' || search_query || '%' OR
         p.email ILIKE '%' || search_query || '%')
    ORDER BY 
        t.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7.7 Admin Dashboard Stats
create or replace function get_admin_dashboard_stats()
returns json as $$
declare
    total_users int;
    total_balance decimal;
    pending_deposits int;
    pending_withdrawals int;
begin
    select count(*) into total_users from public.profiles;
    select coalesce(sum(balance), 0) into total_balance from public.profiles;
    select count(*) into pending_deposits from public.transactions where type = 'deposit' and status = 'pending';
    select count(*) into pending_withdrawals from public.transactions where type = 'withdrawal' and status = 'pending';

    return json_build_object(
        'total_users', total_users,
        'total_balance', total_balance,
        'pending_deposits', pending_deposits,
        'pending_withdrawals', pending_withdrawals
    );
end;
$$ language plpgsql security definer;

-- 7.8 Admin: Tool Management (Verify/Reject)
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

-- 7.9 Admin: Get Tools Activity (Sorted with Tie-Breaker)
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
        public.transactions tx on t.id = tx.tool_id and tx.type = 'withdrawal'
    group by 
        t.id
    order by 
        -- Sort: Last Active (Withdrawal OR Update) -> Status Change -> Created
        greatest(coalesce(max(tx.created_at), '1970-01-01'::timestamptz), coalesce(t.updated_at, t.created_at)) desc,
        t.updated_at desc nulls last,
        t.created_at desc;
end;
$$ language plpgsql security definer;

-- 7.10 Admin: Get Recent Withdrawals for Tool
create or replace function get_recent_withdrawals_for_tool(target_tool_id uuid)
returns setof public.transactions as $$
begin
    return query
    select * from public.transactions
    where tool_id = target_tool_id and type = 'withdrawal'
    order by created_at desc
    limit 5;
end;
$$ language plpgsql security definer;

-- 7.11 Admin: Add Earnings (Commissions)
create or replace function admin_add_earning(target_user_id uuid, amount decimal, target_tool_id uuid default null)
returns void as $$
begin
    -- 1. Update total_commission (stats) but NOT the main wallet balance
    update public.profiles 
    set total_commission = total_commission + amount 
    where id = target_user_id;
    
    -- 2. Record transaction (So it appears in "Today's Earning")
    insert into public.transactions (user_id, tool_id, amount, type, status, payment_method, utr)
    values (target_user_id, target_tool_id, amount, 'commission', 'approved', 'system_add', 'bonus_' || floor(extract(epoch from now())));
end;
$$ language plpgsql security definer;

-- 7.12 Today's Earnings
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
      and created_at >= current_date;
      
    return total_earnings;
end;
$$ language plpgsql security definer;

-- 7.13 Admin Settings Helpers
create or replace function get_admin_setting(setting_key text)
returns text as $$
declare
    setting_value text;
begin
    select value into setting_value from public.admin_settings where key = setting_key;
    return setting_value;
end;
$$ language plpgsql security definer;

create or replace function update_admin_setting(setting_key text, new_value text)
returns void as $$
begin
    update public.admin_settings set value = new_value where key = setting_key;
    if not found then
        insert into public.admin_settings (key, value) values (setting_key, new_value);
    end if;
end;
$$ language plpgsql security definer;

-- 7.14 Admin Users Extended (Pagination)
CREATE OR REPLACE FUNCTION get_admin_users_extended(
  search_query text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  email text,
  balance decimal(12, 2),
  is_banned boolean,
  created_at timestamp with time zone,
  today_earnings decimal,
  tools jsonb
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.balance,
    COALESCE(p.is_banned, false) as is_banned,
    p.created_at,
    COALESCE((
      SELECT SUM(t.amount)
      FROM public.transactions t
      WHERE t.user_id = p.id
        AND t.type = 'commission'
        AND t.created_at >= CURRENT_DATE
    ), 0) AS today_earnings,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ut.id,
        'upi_id', ut.upi_id,
        'status', ut.status,
        'platform', ut.platform
      ))
      FROM public.user_tools ut
      WHERE ut.user_id = p.id
    ), '[]'::jsonb) AS tools
  FROM public.profiles p
  WHERE 
    (search_query IS NULL OR 
     p.email ILIKE '%' || search_query || '%' OR 
     p.id::text ILIKE '%' || search_query || '%')
  ORDER BY 
    p.balance DESC NULLS LAST, 
    p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
