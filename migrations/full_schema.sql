-- Enable UUID extension
create extension if not exists "uuid-ossp";

--------------------------------------------------------------------------------
-- 1. MODIFY EXISTING TABLES (Idempotent changes)
--------------------------------------------------------------------------------

-- Add missing columns to PROFILES
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'referral_code') then
        alter table public.profiles add column referral_code text unique;
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'referrer_id') then
        alter table public.profiles add column referrer_id uuid references public.profiles(id);
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'total_commission') then
        alter table public.profiles add column total_commission decimal(12,2) default 0.00;
    end if;
end $$;

-- Add missing columns to TRANSACTIONS
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'type') then
        alter table public.transactions add column type text default 'deposit'; -- defaulting to deposit for safety
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'withdrawal_details') then
        alter table public.transactions add column withdrawal_details jsonb;
    end if;
end $$;

-- Add missing columns to USER TOOLS
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'user_tools' and column_name = 'name') then
        alter table public.user_tools add column name text;
    end if;
    -- Ensure default status is compatible (we'll handle it in application logic or update default here if needed)
    -- Ideally, we'd change column default, but let's just tolerate text.
end $$;


--------------------------------------------------------------------------------
-- 2. POLICIES (Drop first to avoid conflicts)
--------------------------------------------------------------------------------

-- Profiles policies
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Users can update own profile." on public.profiles;
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
create policy "Users can update own profile." on public.profiles for update using (auth.uid() = id);

-- Transactions policies
drop policy if exists "Users can view own transactions" on public.transactions;
drop policy if exists "Users can insert own transactions" on public.transactions;
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions for insert with check (auth.uid() = user_id);

-- User Tools policies
drop policy if exists "Users can view own tools" on public.user_tools;
drop policy if exists "Users can update own tools" on public.user_tools;
drop policy if exists "Users can insert own tools" on public.user_tools;
create policy "Users can view own tools" on public.user_tools for select using (auth.uid() = user_id);
create policy "Users can update own tools" on public.user_tools for update using (auth.uid() = user_id);
create policy "Users can insert own tools" on public.user_tools for insert with check (auth.uid() = user_id);


--------------------------------------------------------------------------------
-- 3. FUNCTIONS & TRIGGERS (Drop first to avoid return type conflicts)
--------------------------------------------------------------------------------

-- Trigger for new user profile
drop function if exists public.handle_new_user() cascade;
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, referral_code)
  values (new.id, new.email, substring(md5(random()::text) from 1 for 8))
  on conflict (id) do nothing; -- Handle case if profile already exists
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- Admin: Get All Profiles
drop function if exists get_all_profiles() cascade;
create or replace function get_all_profiles()
returns setof public.profiles as $$
begin
  return query select * from public.profiles order by created_at desc;
end;
$$ language plpgsql security definer;


-- Admin: Approve Transaction
drop function if exists approve_transaction(uuid) cascade;
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


-- Admin: Reject Transaction
drop function if exists reject_transaction(uuid) cascade;
create or replace function reject_transaction(transaction_id uuid)
returns void as $$
begin
  update public.transactions set status = 'rejected' where id = transaction_id;
  -- If withdrawal was deducted on request, refund here? 
  -- Without withdrawal logic detail, safe to just mark rejected for now.
end;
$$ language plpgsql security definer;


-- Admin: Update User Balance
drop function if exists admin_update_balance(uuid, decimal) cascade;
create or replace function admin_update_balance(user_id uuid, new_balance decimal)
returns void as $$
begin
  update public.profiles set balance = new_balance where id = user_id;
end;
$$ language plpgsql security definer;


-- User: Get Team Stats (Multi-level)
drop function if exists get_team_stats(uuid) cascade;
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
  
  -- Dummy logic for commissions
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


-- Admin: Get All Transactions
drop function if exists get_all_transactions() cascade;
create or replace function get_all_transactions()
returns setof public.transactions as $$
begin
  return query select * from public.transactions order by created_at desc;
end;
$$ language plpgsql security definer;

-- Admin: Dashboard Stats
drop function if exists get_admin_dashboard_stats() cascade;
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

-- Admin: Get All Tools
drop function if exists get_all_tools() cascade;
create or replace function get_all_tools()
returns setof public.user_tools as $$
begin
    return query select * from public.user_tools order by created_at desc;
end;
$$ language plpgsql security definer;

-- Admin: Verify Tool
drop function if exists verify_tool(uuid) cascade;
create or replace function verify_tool(tool_id uuid)
returns void as $$
begin
    update public.user_tools set status = 'stopped' where id = tool_id; -- Set to stopped initially after verify, so user can start it? Or 'running'?
    -- Let's set it to 'stopped' so user has to explicitly start it, or 'running' if checking means it's good to go.
    -- Request said "user can run those till then we will show pending". 
    -- Actually request: "after that user can run those". So maybe start as 'stopped' or 'active' (but not running).
    -- Let's standardise: 'pending_verification' -> 'stopped' (Verified but off) -> 'running' (On).
    update public.user_tools set status = 'stopped' where id = tool_id;
end;
$$ language plpgsql security definer;

-- Admin: Reject Tool
drop function if exists reject_tool(uuid) cascade;
create or replace function reject_tool(tool_id uuid)
returns void as $$
begin
    update public.user_tools set status = 'rejected' where id = tool_id;
end;
$$ language plpgsql security definer;

-- Create admin_settings table if it doesn't exist
create table if not exists public.admin_settings (
    key text primary key,
    value text
);

-- Insert default UPI ID if not exists
insert into public.admin_settings (key, value)
values ('admin_upi', 'mahawar-akash@ptyes')
on conflict (key) do nothing;

-- Enable RLS
alter table public.admin_settings enable row level security;

-- Policies
create policy "Enable read access for all users" on public.admin_settings for select using (true);
create policy "Enable update for authenticated users only" on public.admin_settings for update using (auth.role() = 'authenticated'); 

-- RPC to get setting
create or replace function get_admin_setting(setting_key text)
returns text as $$
declare
    setting_value text;
begin
    select value into setting_value from public.admin_settings where key = setting_key;
    return setting_value;
end;
$$ language plpgsql security definer;

-- RPC to update setting
create or replace function update_admin_setting(setting_key text, new_value text)
returns void as $$
begin
    update public.admin_settings set value = new_value where key = setting_key;
    if not found then
        insert into public.admin_settings (key, value) values (setting_key, new_value);
    end if;
end;
$$ language plpgsql security definer;

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
-- 1. Add updated_at column to user_tools
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'user_tools' and column_name = 'updated_at') then
        alter table public.user_tools add column updated_at timestamptz default now();
    end if;
end $$;

-- 2. Update status change functions to set updated_at
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

-- 3. Update the fetch function to sort by GREATEST(last_withdrawal, updated_at)
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
        -- Sort by whichever is more recent: the last withdrawal OR the last tool update (status change)
        greatest(coalesce(max(tx.created_at), '1970-01-01'::timestamptz), coalesce(t.updated_at, t.created_at)) desc;
end;
$$ language plpgsql security definer;
-- 1. Add updated_at column to user_tools
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'user_tools' and column_name = 'updated_at') then
        alter table public.user_tools add column updated_at timestamptz default now();
    end if;
end $$;

-- 2. Update status change functions to set updated_at
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

-- 3. Update the fetch function to sort by GREATEST(last_withdrawal, updated_at)
-- DROP first because return type signature is changing
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
        -- Sort by whichever is more recent: the last withdrawal OR the last tool update (status change)
        greatest(coalesce(max(tx.created_at), '1970-01-01'::timestamptz), coalesce(t.updated_at, t.created_at)) desc;
end;
$$ language plpgsql security definer;
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
-- 1. Add tool_id to TRANSACTIONS
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'tool_id') then
        alter table public.transactions add column tool_id uuid references public.user_tools(id);
    end if;
end $$;

-- 2. Update Fetch Logic to join on TOOL_ID (Strict per-tool history)
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
        public.transactions tx on t.id = tx.tool_id and tx.type = 'withdrawal'
    group by 
        t.id
    order by 
        -- Sort logic remains: Last Active (Withdrawal OR Update) -> Status Change -> Created
        greatest(coalesce(max(tx.created_at), '1970-01-01'::timestamptz), coalesce(t.updated_at, t.created_at)) desc,
        t.updated_at desc nulls last,
        t.created_at desc;
end;
$$ language plpgsql security definer;

-- 3. Update 'get_recent_withdrawals_for_user' to 'get_recent_withdrawals_for_tool'
-- We probably want to see tool-specific history in the modal now
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

-- 4. Update Admin Add Earning to tag the TOOL ID
drop function if exists admin_add_earning(uuid, decimal); -- Drop old signature if matches
create or replace function admin_add_earning(target_user_id uuid, amount decimal, target_tool_id uuid default null)
returns void as $$
begin
    update public.profiles 
    set balance = balance + amount 
    where id = target_user_id;
    
    -- Record transaction linked to the tool
    insert into public.transactions (user_id, tool_id, amount, type, status, payment_method, utr)
    values (target_user_id, target_tool_id, amount, 'commission', 'approved', 'system_add', 'bonus_' || floor(extract(epoch from now())));
end;
$$ language plpgsql security definer;
-- Backfill tool_id for existing withdrawals
-- Logic: Assign each orphan withdrawal to the User's most recently created tool.
-- This ensures 'Last Active' and 'History' show up for existing data.

UPDATE public.transactions t
SET tool_id = (
    SELECT id 
    FROM public.user_tools ut 
    WHERE ut.user_id = t.user_id 
    ORDER BY created_at DESC 
    LIMIT 1
)
WHERE t.tool_id IS NULL 
  AND t.type = 'withdrawal';
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
