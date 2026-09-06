-- =====================================================================
-- 1) Locked balance (slot wagering rule)
-- 2) Deposit + withdrawal locked to a single UPI ID per account
-- 3) WhatsApp support number setting
-- ---------------------------------------------------------------------
-- Rules implemented here:
--   * Any INR credited to a wallet WITHOUT a slot purchase (admin balance
--     edit / bonus) is added to profiles.locked_balance.
--   * Buying a slot (an approved deposit) releases that amount from
--     locked_balance.
--   * Withdrawable = balance - locked_balance. request_withdrawal()
--     refuses anything above that.
--   * The first UPI deposit stores the payer's UPI ID on the profile.
--     Every later deposit must come from the same UPI ID, and every
--     withdrawal is paid out to that same UPI ID.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_name = 'profiles' and column_name = 'locked_balance') then
        alter table public.profiles add column locked_balance decimal(12, 2) default 0.00;
    end if;

    if not exists (select 1 from information_schema.columns
                   where table_name = 'profiles' and column_name = 'payout_upi') then
        alter table public.profiles add column payout_upi text;
    end if;

    if not exists (select 1 from information_schema.columns
                   where table_name = 'profiles' and column_name = 'payout_name') then
        alter table public.profiles add column payout_name text;
    end if;

    if not exists (select 1 from information_schema.columns
                   where table_name = 'transactions' and column_name = 'upi_id') then
        alter table public.transactions add column upi_id text;
    end if;
end $$;

update public.profiles set locked_balance = 0.00 where locked_balance is null;

-- ---------------------------------------------------------------------
-- The client must not be able to write to its own profile row: with the
-- old policy a logged-in user could simply set balance / locked_balance /
-- payout_upi from the browser and walk straight past the slot rule. No
-- app code writes to profiles directly - every write goes through a
-- SECURITY DEFINER function below.
-- ---------------------------------------------------------------------
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can update own profile." on public.profiles;

-- ---------------------------------------------------------------------
-- A *pending* withdrawal is the only row an admin ever pays out, so the
-- client must not be able to create one directly - it has to go through
-- request_withdrawal(), where the locked balance and the payout UPI are
-- checked. Deposits and the settled rows written by the withdrawal
-- history screen are still allowed.
-- ---------------------------------------------------------------------
drop policy if exists "Users can insert own transactions" on public.transactions;
drop policy if exists "Users can insert own deposits" on public.transactions;
create policy "Users can insert own transactions" on public.transactions
  for insert with check (
    auth.uid() = user_id
    and (coalesce(type, 'deposit') <> 'withdrawal' or status <> 'pending')
  );

-- ---------------------------------------------------------------------
-- Approve: a deposit is a slot purchase, so it releases locked funds
-- ---------------------------------------------------------------------
create or replace function approve_transaction(transaction_id uuid)
returns void as $$
declare
  txn record;
  final_amount numeric;
  current_balance numeric;
begin
  -- Lock the row so two admins can't approve the same request twice
  select * into txn from public.transactions where id = transaction_id for update;

  if not found then
    raise exception 'Transaction not found';
  end if;

  if txn.status <> 'pending' then
    return; -- Already approved or rejected, do nothing
  end if;

  -- For deposits, credit the converted amount if present (USDT), else amount.
  final_amount := coalesce(txn.converted_amount, txn.amount);

  if txn.type = 'deposit' then
    update public.profiles
      set balance = balance + final_amount,
          -- the user put money on a slot, so release that much of the lock
          locked_balance = greatest(0, coalesce(locked_balance, 0) - final_amount)
      where id = txn.user_id;

  elsif txn.type = 'withdrawal' then
    -- Balance is held until approval, so deduct it now.
    select balance into current_balance from public.profiles where id = txn.user_id;
    if current_balance < txn.amount then
      raise exception 'Insufficient balance to approve withdrawal';
    end if;
    update public.profiles
      set balance = balance - txn.amount,
          -- the lock can never exceed the remaining balance
          locked_balance = least(coalesce(locked_balance, 0), balance - txn.amount)
      where id = txn.user_id;
  end if;

  update public.transactions set status = 'approved' where id = transaction_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Admin balance edits: money handed to a user is locked until they
-- put it on a slot. Reducing a balance never increases the lock.
-- ---------------------------------------------------------------------
create or replace function admin_update_balance(user_id uuid, new_balance decimal)
returns void
language plpgsql security definer
as $$
declare
  old_balance numeric;
  delta numeric;
begin
  select balance into old_balance from public.profiles where id = user_id for update;
  if not found then
    raise exception 'User not found';
  end if;

  delta := new_balance - coalesce(old_balance, 0);

  update public.profiles
    set balance = new_balance,
        locked_balance = case
          when delta > 0 then coalesce(locked_balance, 0) + delta
          else least(coalesce(locked_balance, 0), new_balance)
        end
    where id = user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Deposit submission: enforces one UPI ID per account
-- ---------------------------------------------------------------------
create or replace function submit_upi_deposit(
  p_amount numeric,
  p_utr text,
  p_upi_id text,
  p_method text default 'upi'
)
returns uuid
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_upi text;
  v_utr text;
  v_registered text;
  v_txn_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

  v_utr := trim(coalesce(p_utr, ''));
  if v_utr = '' then
    raise exception 'Please enter the UTR number';
  end if;

  v_upi := lower(trim(coalesce(p_upi_id, '')));
  if v_upi !~ '^[a-zA-Z0-9._-]+@[a-zA-Z]+$' then
    raise exception 'Invalid UPI ID format. Example: 9876543210@paytm';
  end if;

  select payout_upi into v_registered from public.profiles where id = v_user_id for update;

  if v_registered is null then
    update public.profiles set payout_upi = v_upi where id = v_user_id;
  elsif v_registered <> v_upi then
    raise exception 'Deposits are accepted only from your registered UPI ID (%). Withdrawals are paid to the same ID.', v_registered;
  end if;

  if exists (select 1 from public.transactions
             where utr = v_utr and status <> 'rejected') then
    raise exception 'This UTR has already been submitted';
  end if;

  insert into public.transactions (user_id, amount, type, status, payment_method, utr, upi_id)
  values (v_user_id, p_amount, 'deposit', 'pending', coalesce(p_method, 'upi'), v_utr, v_upi)
  returning id into v_txn_id;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Withdrawal request: locked funds must be put on a slot first, and the
-- payout always goes to the registered UPI ID.
-- ---------------------------------------------------------------------
create or replace function request_withdrawal(p_amount numeric)
returns uuid
language plpgsql security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_locked numeric;
  v_available numeric;
  v_txn_id uuid;
begin
  if v_user_id is null then
    raise exception 'Please login first';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Please enter a valid amount';
  end if;

  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  if coalesce(v_profile.is_banned, false) then
    raise exception 'Your account is suspended';
  end if;

  if v_profile.payout_upi is null then
    raise exception 'Buy a slot first. Withdrawals are paid only to the UPI ID you deposited from.';
  end if;

  if p_amount > coalesce(v_profile.balance, 0) then
    raise exception 'Insufficient balance';
  end if;

  v_locked := coalesce(v_profile.locked_balance, 0);
  v_available := coalesce(v_profile.balance, 0) - v_locked;

  if p_amount > v_available then
    raise exception 'Rs % of your balance has not been used on a slot yet. Put it on a slot before withdrawing (withdrawable: Rs %).',
      to_char(v_locked, 'FM999999990.00'),
      to_char(greatest(v_available, 0), 'FM999999990.00');
  end if;

  insert into public.transactions (user_id, amount, type, status, payment_method, utr, upi_id)
  values (
    v_user_id,
    p_amount,
    'withdrawal',
    'pending',
    'upi',
    'WD_' || floor(extract(epoch from now()))::text || '_' || floor(random() * 1000)::text,
    v_profile.payout_upi
  )
  returning id into v_txn_id;

  return v_txn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin panel: surface the UPI ID on every transaction
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_all_transactions();
DROP FUNCTION IF EXISTS get_all_transactions(text);

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
    chain text,
    upi_id text
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
        -- deposits show the UPI actually recorded on the payment; for a
        -- withdrawal fall back to the account's registered payout UPI
        case when t.type = 'withdrawal' then coalesce(t.upi_id, p.payout_upi)
             else t.upi_id end as upi_id
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
-- Admin panel: show locked balance and registered UPI on the users tab
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_admin_users_extended();
DROP FUNCTION IF EXISTS get_admin_users_extended(text, int, int);

CREATE OR REPLACE FUNCTION get_admin_users_extended(
  search_query text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  email text,
  balance decimal(12, 2),
  locked_balance decimal(12, 2),
  payout_upi text,
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
    COALESCE(p.locked_balance, 0.00)::decimal(12, 2) AS locked_balance,
    p.payout_upi,
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
     p.payout_upi ILIKE '%' || search_query || '%' OR
     p.id::text ILIKE '%' || search_query || '%')
  ORDER BY
    p.balance DESC NULLS LAST,
    p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ---------------------------------------------------------------------
-- Support contact settings
-- ---------------------------------------------------------------------
insert into public.admin_settings (key, value)
values ('whatsapp_number', '')
on conflict (key) do nothing;

insert into public.admin_settings (key, value)
values ('telegram_link', 'https://t.me/ZPayService')
on conflict (key) do nothing;
