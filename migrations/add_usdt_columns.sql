-- Add currency and chain columns to transactions table
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'currency') then
        alter table public.transactions add column currency text default 'INR';
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'chain') then
        alter table public.transactions add column chain text;
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'crypto_address') then
        alter table public.transactions add column crypto_address text;
    end if;
end $$;
