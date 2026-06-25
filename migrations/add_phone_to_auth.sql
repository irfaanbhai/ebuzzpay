-- =====================================================================
-- Add Mobile Number to the auth / profile system
-- ---------------------------------------------------------------------
-- Signup now collects: Mobile no., Email, Password, Confirm Password.
-- The mobile number is passed through auth metadata and stored on the
-- profiles row when the account is created.
-- =====================================================================

-- 1. Add phone column to profiles
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'phone') then
        alter table public.profiles add column phone text;
    end if;
end $$;

-- 2. Capture the phone number from signup metadata when the user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  referrer_code_input text;
  referrer_id_lookup uuid;
BEGIN
  -- Extract referral code from user metadata
  referrer_code_input := new.raw_user_meta_data->>'referrer_code';

  -- If provided, try to find the referrer
  IF referrer_code_input IS NOT NULL THEN
    SELECT id INTO referrer_id_lookup FROM public.profiles WHERE referral_code = referrer_code_input;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    phone,
    balance,
    referral_code,
    referrer_id
  )
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'phone',
    0.00,
    substring(md5(random()::text) from 1 for 8),
    referrer_id_lookup
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
