-- Update handle_new_user to process referrer_code from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  referrer_code_input text;
  referrer_id_lookup uuid;
BEGIN
  -- Extract referral code from user metadata (passed during signUp)
  referrer_code_input := new.raw_user_meta_data->>'referrer_code';

  -- If provided, try to find the referrer
  IF referrer_code_input IS NOT NULL THEN
    SELECT id INTO referrer_id_lookup FROM public.profiles WHERE referral_code = referrer_code_input;
  END IF;

  INSERT INTO public.profiles (
    id, 
    email, 
    referral_code, 
    referrer_id -- New: insert referrer_id
  )
  VALUES (
    new.id, 
    new.email, 
    substring(md5(random()::text) from 1 for 8),
    referrer_id_lookup -- Will be null if not found or not provided
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
