'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useCachedQuery } from '@/hooks/useCachedQuery'

// The wallet earns 5% every 24 hours on one timer per user. Withdrawals
// only lower the amount; the timer stops when the wallet is emptied.
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

// Next payout and the balance it is paid on, as seen at `now`
const summarise = (cycle, now) => {
    if (!cycle?.next_at) return { endsAt: null, total: 0 }

    let endsAt = new Date(cycle.next_at).getTime()
    // Due but not settled by the server yet - that payout is happening
    // now, so count down to the one after it
    if (endsAt <= now) {
        endsAt += Math.ceil((now - endsAt + 1) / SLOT_WAIT_MS) * SLOT_WAIT_MS
    }
    return { endsAt, total: Number(cycle.base || 0) }
}

/**
 * Shared slot timer for the Home and Assets pages.
 *
 * Returns:
 *   endsAt  - ms timestamp of the next 5% payout, or null when stopped
 *   left    - { h, m, s } still to go, or null when stopped
 *   total   - wallet amount the next 5% is paid on (0 when stopped)
 *   refresh - re-read the timer, e.g. after a purchase or withdrawal
 *
 * `onExpire` runs once when a running timer reaches zero.
 */
export function useSlotCycle(userId, onExpire) {
    const [now, setNow] = useState(() => Date.now())

    // next_at is empty until a deposit is approved, and again once the
    // wallet has been emptied
    const { data: cycle, refresh: reload } = useCachedQuery(userId ? `slot-cycle:${userId}` : null, async () => {
        const { data, error } = await createClient().rpc('get_bonus_cycle')
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

    const { endsAt, total } = summarise(cycle, now)

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
