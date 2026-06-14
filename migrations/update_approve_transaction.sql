-- Add converted_amount for cross-currency transactions
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'transactions' and column_name = 'converted_amount') then
        alter table public.transactions add column converted_amount numeric;
    end if;
end $$;

-- Update approve_transaction to use converted_amount if available
create or replace function approve_transaction(transaction_id uuid)
returns void as $$
declare
  txn record;
  final_amount numeric;
begin
  -- Get transaction
  select * into txn from public.transactions where id = transaction_id;
  
  if txn.status = 'approved' then
    return; -- Already approved
  end if;

  -- Determine final amount to add to balance
  -- If converted_amount is set (e.g. for USDT), use it. Otherwise use amount (INR).
  final_amount := coalesce(txn.converted_amount, txn.amount);

  -- Update transaction status
  update public.transactions set status = 'approved' where id = transaction_id;

  -- Update user balance
  if txn.type = 'deposit' then
    update public.profiles set balance = balance + final_amount where id = txn.user_id;
  elsif txn.type = 'withdrawal' then
    -- Typically withdrawals are deducted when requested. If rejected, refunded.
    -- If we approve a withdrawal, balance is already gone.
    null; 
  end if;
end;
$$ language plpgsql security definer;
