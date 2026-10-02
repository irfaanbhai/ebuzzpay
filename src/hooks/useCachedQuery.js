'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

// In-memory cache shared by every page for the life of the tab. Going back
// to a page shows what it showed last time straight away and refreshes it
// in the background, so switching tabs never waits on the network.
const cache = new Map()
const inflight = new Map()

export function clearQueryCache() {
    cache.clear()
    inflight.clear()
}

// Parallel callers of the same key share one request
function fetchOnce(key, fetcher) {
    if (inflight.has(key)) return inflight.get(key)
    const promise = Promise.resolve()
        .then(fetcher)
        .finally(() => inflight.delete(key))
    inflight.set(key, promise)
    return promise
}

/**
 * Stale-while-revalidate data hook.
 *
 *   key     - cache key, or null to wait (e.g. until the user is known)
 *   fetcher - async function returning the data; throw on error so a
 *             failed request never replaces good cached data
 *
 * Returns { data, loading, refresh, mutate }. `loading` is only true while
 * nothing is cached yet.
 */
export function useCachedQuery(key, fetcher) {
    const [state, setState] = useState(() => ({ key, data: key ? cache.get(key) : undefined }))

    const fetcherRef = useRef(fetcher)
    useEffect(() => {
        fetcherRef.current = fetcher
    })

    const refresh = useCallback(async () => {
        if (!key) return undefined
        try {
            const data = await fetchOnce(key, () => fetcherRef.current())
            cache.set(key, data)
            setState({ key, data })
            return data
        } catch (error) {
            console.error(`Failed to load ${key}:`, error)
            return undefined
        }
    }, [key])

    useEffect(() => {
        refresh()
    }, [refresh])

    // Local update, e.g. after a successful write
    const mutate = useCallback((updater) => {
        if (!key) return
        const next = typeof updater === 'function' ? updater(cache.get(key)) : updater
        cache.set(key, next)
        setState({ key, data: next })
    }, [key])

    const data = state.key === key ? state.data : (key ? cache.get(key) : undefined)
    return { data, loading: data === undefined, refresh, mutate }
}

/**
 * Admin setting (telegram link, admin UPI, USDT rate...) cached across pages.
 */
export function useAdminSetting(settingKey, fallback) {
    const { data } = useCachedQuery(`setting:${settingKey}`, async () => {
        const { data, error } = await createClient().rpc('get_admin_setting', { setting_key: settingKey })
        if (error) throw error
        return data ?? null
    })
    return data || fallback
}

// undefined = not checked yet, null = signed out
let sessionUser

/**
 * The signed-in user, read from the local session instead of a network
 * round trip to the auth server on every page. Data access is still
 * enforced by RLS on the server, and the proxy verifies the session for
 * protected routes.
 */
export function useSessionUser({ redirectTo = '/login' } = {}) {
    const router = useRouter()
    const [user, setUser] = useState(() => sessionUser ?? null)

    useEffect(() => {
        const supabase = createClient()
        let ignore = false

        supabase.auth.getSession().then(({ data: { session } }) => {
            if (ignore) return
            sessionUser = session?.user ?? null
            setUser(sessionUser)
            if (!sessionUser && redirectTo) router.replace(redirectTo)
        })

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') clearQueryCache()
            sessionUser = session?.user ?? null
            setUser(sessionUser)
        })

        return () => {
            ignore = true
            subscription.unsubscribe()
        }
    }, [router, redirectTo])

    return user
}
