-- =====================================================================
-- Bank-account tools: let users link a bank account as a tool, the same
-- way they link a UPI ID.
-- ---------------------------------------------------------------------
--   * user_tools can now hold a bank account (account number, IFSC,
--     bank name) instead of a UPI ID. upi_id becomes nullable and
--     platform = 'bank' marks a bank tool.
--   * check_bank_exists() mirrors check_upi_exists() for the global
--     "account already linked" check.
-- =====================================================================

-- A bank tool has no UPI ID
alter table public.user_tools alter column upi_id drop not null;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'user_tools' and column_name = 'account_number') then
    alter table public.user_tools add column account_number text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'user_tools' and column_name = 'ifsc_code') then
    alter table public.user_tools add column ifsc_code text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'user_tools' and column_name = 'bank_name') then
    alter table public.user_tools add column bank_name text;
  end if;
end $$;

-- Global check: is this bank account already linked as a tool anywhere?
create or replace function check_bank_exists(account_number_input text, ifsc_input text)
returns boolean as $$
declare
  exists_flag boolean;
begin
  select exists(
    select 1 from public.user_tools
    where account_number = trim(account_number_input)
      and upper(ifsc_code) = upper(trim(ifsc_input))
  ) into exists_flag;
  return exists_flag;
end;
$$ language plpgsql security definer;
