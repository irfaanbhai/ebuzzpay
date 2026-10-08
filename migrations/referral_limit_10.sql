-- =====================================================================
-- Referral bonus for the first 10 referrals, unlimited team
-- ---------------------------------------------------------------------
-- Run this AFTER deposit_restarts_bonus_timer.sql - it redefines
-- is_rewarded_referral(), handle_new_user() and get_team_stats() from
-- inr_lock_withdraw_hold_multi_upi.sql.
--
-- Rules:
--   * The referral bonus is paid only for a user's first 10 referrals
--     (was 5).
--   * Signups beyond 10 are still linked to the referrer, so they count
--     in the team (and in levels B / C), but they earn the referrer no
--     referral bonus.
-- =====================================================================

-- true when target_user is one of the referrer's first 10 referrals
create or replace function is_rewarded_referral(referrer uuid, target_user uuid)
returns boolean
language sql stable security definer
as $$
  select target_user in (
    select p.id from public.profiles p
    where p.referrer_id = referrer
    order by p.created_at, p.id
    limit 10
  );
$$;

-- Every signup with a valid referral code joins the referrer's team
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  referrer_code_input text;
  referrer_id_lookup uuid;
BEGIN
  referrer_code_input := new.raw_user_meta_data->>'referrer_code';

  IF referrer_code_input IS NOT NULL THEN
    SELECT id INTO referrer_id_lookup
      FROM public.profiles WHERE referral_code = referrer_code_input;
  END IF;

  INSERT INTO public.profiles (id, email, referral_code, referrer_id)
  VALUES (
    new.id,
    new.email,
    substring(md5(random()::text) from 1 for 8),
    referrer_id_lookup
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- Team stats: 10 referral bonus limit
-- ---------------------------------------------------------------------
create or replace function get_team_stats(query_user_id uuid)
returns json as $$
declare
  total_comm decimal;
  comm_today decimal;
  comm_yest decimal;
  team_cnt int;
  team_cnt_b int;
  team_cnt_c int;
  new_team_cnt int;
  ref_earned decimal;
  ref_rate numeric;
begin
  select total_commission into total_comm from public.profiles where id = query_user_id;

  select coalesce(sum(amount), 0) into comm_today
    from public.transactions
    where user_id = query_user_id and type = 'commission'
      and created_at >= ist_day_start()
      and created_at <= now();

  select coalesce(sum(amount), 0) into comm_yest
    from public.transactions
    where user_id = query_user_id and type = 'commission'
      and created_at >= ist_day_start() - interval '1 day'
      and created_at < ist_day_start();

  select coalesce(sum(amount), 0) into ref_earned
    from public.transactions
    where user_id = query_user_id and type = 'commission'
      and payment_method = 'referral_bonus';

  -- Level A (Direct)
  select count(*) into team_cnt from public.profiles where referrer_id = query_user_id;

  -- Level B (Indirect L2)
  select count(*) into team_cnt_b from public.profiles where referrer_id in (
    select id from public.profiles where referrer_id = query_user_id
  );

  -- Level C (Indirect L3)
  select count(*) into team_cnt_c from public.profiles where referrer_id in (
    select id from public.profiles where referrer_id in (
      select id from public.profiles where referrer_id = query_user_id
    )
  );

  -- New Team (joined last 24h)
  select count(*) into new_team_cnt from public.profiles
    where referrer_id = query_user_id and created_at > now() - interval '24 hours';

  ref_rate := referral_rate_for(query_user_id);

  return json_build_object(
    'total_commission', coalesce(total_comm, 0),
    'commission_today', comm_today,
    'commission_yesterday', comm_yest,
    'team_count', team_cnt,
    'level_b_count', team_cnt_b,
    'level_c_count', team_cnt_c,
    'today_new_team', new_team_cnt,
    'referral_earned', ref_earned,
    'referral_rate', ref_rate * 100,
    'referral_limit', 10,
    'referral_slots_left', greatest(10 - team_cnt, 0)
  );
end;
$$ language plpgsql security definer;
