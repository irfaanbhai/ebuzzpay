-- 1. Add is_banned column to profiles
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'is_banned') then
        alter table public.profiles add column is_banned boolean default false;
    end if;
end $$;

-- 2. Create/Update RPC to get all profiles (including ban status)
-- We need to drop the old one if the return type signature changes implicitly or explicitly
-- If 'get_all_profiles' returns 'setof profiles', it will automatically include the new column!
-- So we just need to ensure the column exists.

-- 3. RPC to toggle ban status
create or replace function toggle_ban_user(target_user_id uuid, ban_status boolean)
returns void as $$
begin
    update public.profiles 
    set is_banned = ban_status 
    where id = target_user_id;
    
    -- Optional: If we had permissions, we could try:
    -- update auth.users set banned_until = (case when ban_status then 'infinity' else null end) where id = target_user_id;
    -- But usually this fails without superuser or specific grants.
    -- We will rely on application-level checks via 'is_banned'.
end;
$$ language plpgsql security definer;
