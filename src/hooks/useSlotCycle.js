'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

// A slot's 5% commission is credited 24 hours after the slot is approved.
// Buying another slot while that wait is running restarts the timer, so a
// "cycle" is a run of slots each approved before the previous one matured.
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

const STOPPED = { endsAt: null, total: 0 }

/**
 * Shared slot timer for the Home and Assets pages.
 *
 * Returns:
 *   endsAt  - ms timestamp the running timer ends at, or null when stopped
 *   left    - { h, m, s } still to go, or null when stopped
 *   total   - INR placed on slots during the running cycle (0 when stopped)
 *   refresh - re-read the slots, e.g. after a purchase
 *
 * `onExpire` runs once when a running timer reaches zero.
 */
export function useSlotCycle(userId, onExpire) {
    const supabase = createClient()
    const [cycle, setCycle] = useState(STOPPED)
    const [now, setNow] = useState(() => Date.now())
    const [reloadKey, setReloadKey] = useState(0)

    const onExpireRef = useRef(onExpire)
    useEffect(() => {
        onExpireRef.current = onExpire
    })

    const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

    useEffect(() => {
        if (!userId) return
        let ignore = false

        const load = async () => {
            const { data: slots, error } = await supabase
                .from('slot_commissions')
                .select('slot_amount, mature_at')
                .eq('user_id', userId)
                .order('mature_at', { ascending: false })
                .limit(100)

            if (ignore) return
            const fetchedAt = Date.now()
            setNow(fetchedAt)

            if (error || !slots?.length) {
                setCycle(STOPPED)
                return
            }

            const latest = new Date(slots[0].mature_at).getTime()
            if (latest <= fetchedAt) {
                // Last slot has already matured - stopped until the next purchase
                setCycle(STOPPED)
                return
            }

            // Walk back through the slots that kept restarting the timer
            let total = 0
            let later = null
            for (const slot of slots) {
                const at = new Date(slot.mature_at).getTime()
                if (later !== null && later - at >= SLOT_WAIT_MS) break
                total += Number(slot.slot_amount || 0)
                later = at
            }

            setCycle({ endsAt: latest, total })
        }

        load()
        return () => {
            ignore = true
        }
    }, [supabase, userId, reloadKey])

    // Tick every second while a timer is running
    useEffect(() => {
        if (!cycle.endsAt) return

        let expired = false
        const id = setInterval(() => {
            const current = Date.now()
            setNow(current)
            if (current >= cycle.endsAt && !expired) {
                expired = true
                refresh()
                onExpireRef.current?.()
            }
        }, 1000)
        return () => clearInterval(id)
    }, [cycle.endsAt, refresh])

    // Coming back to the tab after buying a slot picks up the new timer
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') refresh()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [refresh])

    const left = cycle.endsAt ? splitDuration(cycle.endsAt - now) : null

    return { endsAt: cycle.endsAt, left, total: cycle.total, refresh }
}
