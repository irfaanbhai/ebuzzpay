-- =====================================================================
-- Fix: rejecting a withdrawal restarted the 5% bonus even when another
-- withdrawal was still pending / approved
-- ---------------------------------------------------------------------
-- Run this AFTER inr_lock_withdraw_hold_multi_upi.sql - it redefines
-- reject_transaction() on top of that version.
--
-- What went wrong:
--   * Withdrawal A stops the bonus (slot_commissions.stopped_by = A).
--   * Withdrawal B, a minute later, finds nothing running, so the rows
--     still point at A.
--   * Admin rejects A (duplicate) and approves B. reject_transaction()
--     restarted every row stopped by A, so the bonus kept paying even
--     though the user had withdrawn.
--
-- Now a rejected withdrawal hands the stop over to the user's next
-- pending / approved withdrawal made after that deposit. The bonus only
-- restarts when no such withdrawal exists.
-- =====================================================================

create or replace function reject_transaction(transaction_id uuid)
returns void as $$
declare
  v_rejected uuid;
  v_user uuid;
  v_amount numeric;
  v_type text;
  v_held boolean;
begin
  update public.transactions t
    set status = 'rejected'
    where t.id = reject_transaction.transaction_id and t.status = 'pending'
    returning t.id, t.user_id, t.amount, t.type, coalesce(t.balance_held, false)
    into v_rejected, v_user, v_amount, v_type, v_held;

  if v_rejected is not null then
    if v_type = 'withdrawal' and v_held then
      update public.profiles
        set balance = balance + v_amount
        where id = v_user;
    end if;

    -- Another real withdrawal still stands: it now owns the stop
    update public.slot_commissions sc
      set stopped_by = (
        select w.id from public.transactions w
        where w.user_id = sc.user_id
          and w.type = 'withdrawal'
          and w.tool_id is null
          and w.status in ('pending', 'approved')
          and w.id <> v_rejected
          and w.created_at > sc.created_at
        order by w.created_at
        limit 1
      )
      where sc.stopped_by = v_rejected
        and exists (
          select 1 from public.transactions w
          where w.user_id = sc.user_id
            and w.type = 'withdrawal'
            and w.tool_id is null
            and w.status in ('pending', 'approved')
            and w.id <> v_rejected
            and w.created_at > sc.created_at
        );

    -- Nothing else stands: the bonus carries on (missed payouts are
    -- caught up on the next settlement)
    update public.slot_commissions
      set credited_at = null,
          stopped_by = null
      where stopped_by = v_rejected;
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- Stop bonuses that were wrongly restarted. This only stops future
-- payouts; it does NOT take back what was already paid (see the
-- review queries in the PR / chat before correcting balances).
-- ---------------------------------------------------------------------
with first_wd as (
  select distinct on (sc.id) sc.id as sc_id, t.id as wd_id, t.created_at
  from public.slot_commissions sc
  join public.transactions t
    on t.user_id = sc.user_id
   and t.type = 'withdrawal'
   and t.tool_id is null
   and t.status in ('pending', 'approved')
   and t.created_at > sc.created_at
  where sc.credited_at is null
  order by sc.id, t.created_at
)
update public.slot_commissions sc
  set credited_at = f.created_at,
      stopped_by = f.wd_id
  from first_wd f
  where sc.id = f.sc_id;
