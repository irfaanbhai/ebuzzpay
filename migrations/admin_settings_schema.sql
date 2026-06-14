
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
