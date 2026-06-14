-- RPC to check if a UPI ID exists globally (ignoring RLS)
create or replace function check_upi_exists(upi_id_input text)
returns boolean as $$
declare
  exists_flag boolean;
begin
  select exists(select 1 from public.user_tools where lower(upi_id) = lower(upi_id_input)) into exists_flag;
  return exists_flag;
end;
$$ language plpgsql security definer;
