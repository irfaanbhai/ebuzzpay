
-- Seed default USDT rate setting (admin-editable from Settings tab)
insert into public.admin_settings (key, value)
values ('usdt_rate', '102.0')
on conflict (key) do nothing;
