'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useCachedQuery } from '@/hooks/useCachedQuery'

// Every approved slot earns 5% each 24 hours until the user withdraws.
// After each payout the next 24 hours start, so the timer counts down to
// the soonest upcoming payout across all running slots.
export const SLOT_WAIT_MS = 24 * 60 * 60 * 1000

const pad = (n) => String(n).padStart(2, '0')

const splitDuration = (ms) => {
    const diff = Math.max(0, ms)
    return {
        h: pad(Math.floor(diff / 3600000)),
        m: pad(Math.floor(diff / 60000) % 60),
        s: pad(Math.floor(diff / 1000) % 60),
    }
}

// Next payout and earning total for the running slots, as seen at `now`
const summarise = (slots, now) => {
    if (!slots?.length) return { endsAt: null, total: 0 }

    let endsAt = null
    let total = 0
    for (const slot of slots) {
        let at = new Date(slot.mature_at).getTime()
        // Due but not settled by the server yet - that payout is
        // happening now, so count down to the one after it
        if (at <= now) {
            at += Math.ceil((now - at + 1) / SLOT_WAIT_MS) * SLOT_WAIT_MS
        }
        if (endsAt === null || at < endsAt) endsAt = at
        total += Number(slot.slot_amount || 0)
    }
    return { endsAt, total }
}

/**
 * Shared slot timer for the Home and Assets pages.
 *
 * Returns:
 *   endsAt  - ms timestamp of the next 5% payout, or null when stopped
 *   left    - { h, m, s } still to go, or null when stopped
 *   total   - INR on slots that are still earning (0 when stopped)
 *   refresh - re-read the slots, e.g. after a purchase or withdrawal
 *
 * `onExpire` runs once when a running timer reaches zero.
 */
export function useSlotCycle(userId, onExpire) {
    const [now, setNow] = useState(() => Date.now())

    // credited_at stays empty while the bonus keeps repeating;
    // a withdrawal fills it in and stops the bonus
    const { data: slots, refresh: reload } = useCachedQuery(userId ? `slot-cycle:${userId}` : null, async () => {
        const { data, error } = await createClient()
            .from('slot_commissions')
            .select('slot_amount, mature_at')
            .eq('user_id', userId)
            .is('credited_at', null)
            .limit(100)
        if (error) throw error
        return data
    })

    const refresh = useCallback(async () => {
        await reload()
        setNow(Date.now())
    }, [reload])

    const onExpireRef = useRef(onExpire)
    useEffect(() => {
        onExpireRef.current = onExpire
    })

    const { endsAt, total } = summarise(slots, now)

    // Tick every second while a timer is running
    useEffect(() => {
        if (!endsAt) return

        let expired = false
        const id = setInterval(() => {
            const current = Date.now()
            setNow(current)
            if (current >= endsAt && !expired) {
                expired = true
                refresh()
                onExpireRef.current?.()
            }
        }, 1000)
        return () => clearInterval(id)
    }, [endsAt, refresh])

    // Coming back to the tab after buying a slot picks up the new timer
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') refresh()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [refresh])

    const left = endsAt ? splitDuration(endsAt - now) : null

    return { endsAt, left, total, refresh }
}
