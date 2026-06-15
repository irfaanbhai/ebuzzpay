
-- Add default Telegram support link setting if it doesn't exist.
-- Uses the existing admin_settings key/value table and get/update RPCs.
insert into public.admin_settings (key, value)
values ('telegram_link', 'https://t.me/ZPayService')
on conflict (key) do nothing;
