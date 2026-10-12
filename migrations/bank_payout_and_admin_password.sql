-- =====================================================================
-- Bank account payout option for withdrawals + DB-stored admin password
-- ---------------------------------------------------------------------
-- Run AFTER inr_lock_withdraw_hold_multi_upi.sql and
-- withdrawal_refund_and_txn_times.sql. This migration redefines
-- request_withdrawal(), get_wallet_summary(), get_all_transactions()
-- and get_admin_user_history(), and adds bank-account storage plus a
-- DB-backed admin password.
--
--   * Users can save bank accounts (holder name, account number, IFSC)
--     next to their UPI IDs and withdraw to either one. Bank payouts are
--     kept in transactions.withdrawal_details with payment_method 'bank'.
--   * The admin password is no longer hardcoded in the app. It lives
--     bcrypt-hashed in admin_credentials, seeded with the current
--     password, and the admin can change it from the Settings tab.
-- =====================================================================

create extension if not exists pgcrypto;

-- withdrawal_details exists in the base schema; add it defensively in
-- case this database was built from an older schema.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'transactions' and column_name = 'withdrawal_details') then
    alter table public.transactions add column withdrawal_details jsonb;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Saved bank accounts, same ownership model as user_payout_upis
-- ---------------------------------------------------------------------
create table if not exists public.user_payout_banks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_holder text not null,
  account_number text not null check (account_number ~ '^[0-9]{6,20}$'),
  ifsc_code text not null check (ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name text,
  created_at timestamptz not null default now(),
  unique (user_id, account_number, ifsc_code)
);

create index if not exists user_payout_banks_user_idx on public.user_payout_banks (user_id);

alter table public.user_payout_banks enable row level security;

drop policy if exists "Users can view own payout banks" on public.user_payout_banks;
create policy "Users can view own payout banks" on public.user_payout_banks
  for select using (auth.uid() = user_id);

drop policy if exists "Users can add own payout banks" on public.user_payout_banks;
create policy "Users can add own payout banks" on public.user_payout_banks
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can remove own payout banks" on public.user_payout_banks;
create policy "Users can remove own payout banks" on public.user_payout_banks
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- request_withdrawal(): withdraw to a saved UPI ID or a saved bank
-- account. Pass p_bank_id for a bank payout, otherwise p_upi_id (or the
-- account's registered UPI) is used, exactly as before.
-- ---------------------------------------------------------------------
drop function if exists request_withdrawal(numeric);
drop function if exists request_withdrawal(numeric, text);

create or replace function request_withdrawal(
  p_amount numeric,
  p_upi_id text default null,
  p_bank_id uuid default null
)
returns uuid
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_bank record;
  v_upi text;
  v_locked numeric;
  v_available numeric;
  v_unlock_at timestamptz;
  v_txn_id uuid;
  v_method text;
  v_details jsonb;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Please enter a valid amount';
  end if;

  -- Pays every bonus cycle that is already due before it is stopped
  perform release_due_slot_commissions(v_user_id);

  -- Row lock also serialises parallel requests, so the daily count holds
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  if coalesce(v_profile.is_banned, false) then
    raise exception 'Your account is suspended';
  end if;

  -- Resolve the payout destination: a bank account, or a UPI ID
  if p_bank_id is not null then
    select * into v_bank
      from public.user_payout_banks
      where id = p_bank_id and user_id = v_user_id;
    if not found then
      raise exception 'Selected bank account was not found';
    end if;
    v_method := 'bank';
    v_upi := null;
    v_details := jsonb_build_object(
      'account_holder', v_bank.account_holder,
      'account_number', v_bank.account_number,
      'ifsc_code', v_bank.ifsc_code,
      'bank_name', v_bank.bank_name
    );
  else
    v_upi := lower(trim(coalesce(nullif(trim(p_upi_id), ''), v_profile.payout_upi, '')));
    if v_upi = '' then
      raise exception 'Please add a UPI ID or bank account to receive the withdrawal';
    end if;
    if v_upi !~ '^[a-z0-9._-]+@[a-z]+$' then
      raise exception 'Invalid UPI ID format. Example: 9876543210@paytm';
    end if;
    v_method := 'upi';
    v_details := null;
  end if;

  if withdrawals_today(v_user_id) >= 3 then
    raise exception 'You can make only 3 withdrawals per day. Try again tomorrow.';
  end if;

  if p_amount > coalesce(v_profile.balance, 0) then
    raise exception 'Insufficient balance';
  end if;

  v_locked := inr_locked_amount(v_user_id);
  v_available := coalesce(v_profile.balance, 0) - v_locked;

  if p_amount > v_available then
    v_unlock_at := inr_unlock_at(v_user_id);
    raise exception 'Rs % from your INR deposit is locked for its first 24 hours (unlocks at % IST). You can withdraw up to Rs % now.',
      to_char(v_locked, 'FM999999990.00'),
      to_char(v_unlock_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'),
      to_char(greatest(v_available, 0), 'FM999999990.00');
  end if;

  insert into public.transactions (user_id, amount, type, status, payment_method, utr, upi_id, withdrawal_details, balance_held)
  values (
    v_user_id,
    p_amount,
    'withdrawal',
    'pending',
    v_method,
    'WD_' || floor(extract(epoch from now()))::text || '_' || floor(random() * 1000)::text,
    v_upi,
    v_details,
    true
  )
  returning id into v_txn_id;

  -- Held until the admin decides: approve keeps it out, reject returns it.
  -- Only a UPI payout updates the account's default payout UPI.
  update public.profiles
    set balance = balance - p_amount,
        payout_upi = case when v_method = 'upi' then v_upi else payout_upi end
    where id = v_user_id;

  if v_method = 'upi' then
    insert into public.user_payout_upis (user_id, upi_id)
    values (v_user_id, v_upi)
    on conflict (user_id, upi_id) do nothing;
  end if;

  -- Withdrawing ends the recurring 5% bonus on every running deposit
  update public.slot_commissions
    set credited_at = now(),
        stopped_by = v_txn_id
    where user_id = v_user_id
      and credited_at is null;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Wallet summary: now also returns the user's saved bank accounts
-- ---------------------------------------------------------------------
create or replace function get_wallet_summary()
returns json
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_pending numeric;
  v_next timestamptz;
  v_running numeric;
  v_locked numeric;
  v_in_process numeric;
  v_upis json;
  v_banks json;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  perform release_due_slot_commissions(v_user_id);

  select * into v_profile from public.profiles where id = v_user_id;
  if not found then
    raise exception 'Profile not found';
  end if;

  -- pending = what the running deposits pay out every 24 hours
  select coalesce(sum(amount), 0), min(mature_at), coalesce(sum(slot_amount), 0)
    into v_pending, v_next, v_running
    from public.slot_commissions
    where user_id = v_user_id and credited_at is null;

  v_locked := inr_locked_amount(v_user_id);

  select coalesce(sum(amount), 0) into v_in_process
    from public.transactions
    where user_id = v_user_id
      and type = 'withdrawal'
      and status = 'pending'
      and balance_held;

  select coalesce(json_agg(u.upi_id order by u.created_at), '[]'::json) into v_upis
    from public.user_payout_upis u
    where u.user_id = v_user_id;

  select coalesce(json_agg(
           json_build_object(
             'id', b.id,
             'account_holder', b.account_holder,
             'account_number', b.account_number,
             'ifsc_code', b.ifsc_code,
             'bank_name', b.bank_name
           ) order by b.created_at
         ), '[]'::json) into v_banks
    from public.user_payout_banks b
    where b.user_id = v_user_id;

  return json_build_object(
    'balance', coalesce(v_profile.balance, 0),
    'locked_balance', v_locked,
    'locked_until', inr_unlock_at(v_user_id),
    'withdrawable', greatest(coalesce(v_profile.balance, 0) - v_locked, 0),
    'withdrawal_in_process', v_in_process,
    'pending_commission', v_pending,
    'next_commission_at', v_next,
    'bonus_running_amount', v_running,
    'payout_upi', v_profile.payout_upi,
    'payout_upis', v_upis,
    'payout_banks', v_banks,
    'withdrawals_today', withdrawals_today(v_user_id),
    'withdrawal_daily_limit', 3,
    'withdraw_window_open', true,
    'today_earnings', today_earnings_for(v_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Admin transactions list: + withdrawal_details (bank payout info)
-- (return type changes, so drop first)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_all_transactions(text);

CREATE FUNCTION get_all_transactions(
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
    chain text,
    upi_id text,
    bonus_amount numeric,
    usdt_amount numeric,
    processed_at timestamptz,
    balance_held boolean,
    refunded_at timestamptz,
    withdrawal_details jsonb
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
        t.chain,
        -- a bank withdrawal has no UPI; a UPI withdrawal falls back to
        -- the account's registered payout UPI; deposits show their own
        case when t.type = 'withdrawal' and t.payment_method = 'bank' then null
             when t.type = 'withdrawal' then coalesce(t.upi_id, p.payout_upi)
             else t.upi_id end as upi_id,
        coalesce(t.bonus_amount, 0) as bonus_amount,
        t.usdt_amount,
        t.processed_at,
        coalesce(t.balance_held, false) as balance_held,
        t.refunded_at,
        t.withdrawal_details
    FROM
        public.transactions t
    LEFT JOIN
        public.profiles p ON t.user_id = p.id
    WHERE
        t.type IN ('deposit', 'withdrawal') AND
        (search_query IS NULL OR
         t.utr ILIKE '%' || search_query || '%' OR
         t.upi_id ILIKE '%' || search_query || '%' OR
         t.user_id::text ILIKE '%' || search_query || '%' OR
         p.email ILIKE '%' || search_query || '%')
    ORDER BY
        -- pending requests first so the admin sees actionable items on top
        (t.status = 'pending') DESC,
        t.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- One user's money timeline: + withdrawal_details (bank payout info)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_admin_user_history(uuid, int);

CREATE FUNCTION get_admin_user_history(target_user_id uuid, p_limit int default 200)
returns table (
  id uuid,
  type text,
  amount numeric,
  status text,
  payment_method text,
  upi_id text,
  utr text,
  requested_at timestamptz,
  processed_at timestamptz,
  withdrawal_details jsonb
)
language sql stable security definer
as $$
  select t.id, t.type, coalesce(t.converted_amount, t.amount), t.status,
         t.payment_method, t.upi_id, t.utr, t.created_at, t.processed_at,
         t.withdrawal_details
  from public.transactions t
  where t.user_id = target_user_id
    and t.tool_id is null
  order by t.created_at desc
  limit p_limit;
$$;

-- =====================================================================
-- DB-backed admin password (replaces the hardcoded one in the app)
-- ---------------------------------------------------------------------
-- The hash lives in admin_credentials. RLS is on with NO policies, so
-- no client (anon or authenticated) can read it directly; only the
-- security-definer functions below, which run as the table owner, can.
-- =====================================================================
create table if not exists public.admin_credentials (
  id int primary key default 1,
  password_hash text not null,
  updated_at timestamptz not null default now(),
  constraint admin_credentials_singleton check (id = 1)
);

alter table public.admin_credentials enable row level security;

-- Seed with the password that was previously hardcoded, so the admin
-- login keeps working unchanged after this migration.
insert into public.admin_credentials (id, password_hash)
values (1, crypt('siya@ram', gen_salt('bf')))
on conflict (id) do nothing;

-- Returns true when the given password matches the stored hash.
create or replace function verify_admin_password(p_password text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from public.admin_credentials where id = 1;
  if v_hash is null then
    return false;
  end if;
  return v_hash = crypt(coalesce(p_password, ''), v_hash);
end;
$$;

-- Changes the password after checking the current one. Returns true on
-- success, false when the current password is wrong.
create or replace function change_admin_password(p_current text, p_new text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from public.admin_credentials where id = 1;
  if v_hash is null or v_hash <> crypt(coalesce(p_current, ''), v_hash) then
    return false;
  end if;
  if p_new is null or length(p_new) < 6 then
    raise exception 'New password must be at least 6 characters';
  end if;
  update public.admin_credentials
    set password_hash = crypt(p_new, gen_salt('bf')), updated_at = now()
    where id = 1;
  return true;
end;
$$;

grant execute on function verify_admin_password(text) to anon, authenticated;
grant execute on function change_admin_password(text, text) to anon, authenticated;
