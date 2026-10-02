'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

// Admin, login and the status pages are always reachable
const isExempt = (pathname) =>
    pathname.startsWith('/admin') ||
    pathname.startsWith('/login') ||
    pathname === '/register' ||
    pathname === '/maintenance' ||
    pathname === '/banned'

export default function MaintenanceGuard({ children }) {
    const [maintenanceMode, setMaintenanceMode] = useState(false)
    const [isBanned, setIsBanned] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const pathname = usePathname()
    const router = useRouter()

    // Maintenance flag: read once, then follow it in realtime
    useEffect(() => {
        const supabase = createClient()

        supabase
            .from('admin_settings')
            .select('value')
            .eq('key', 'maintenance_mode')
            .single()
            .then(({ data }) => {
                if (data) setMaintenanceMode(data.value === 'true')
            })
            .finally(() => setIsLoading(false))

        const channel = supabase
            .channel('maintenance_check')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'admin_settings', filter: 'key=eq.maintenance_mode' },
                (payload) => {
                    if (payload.new) {
                        setMaintenanceMode(payload.new.value === 'true')
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [])

    // Ban status: checked once per sign-in instead of on every page change,
    // so moving between pages doesn't wait on two extra requests
    useEffect(() => {
        const supabase = createClient()
        let ignore = false

        const checkBan = async (userId) => {
            if (!userId) {
                setIsBanned(false)
                return
            }
            const { data: profile } = await supabase
                .from('profiles')
                .select('is_banned')
                .eq('id', userId)
                .single()
            if (!ignore) setIsBanned(Boolean(profile?.is_banned))
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
                checkBan(session?.user?.id)
            }
        })

        return () => {
            ignore = true
            subscription.unsubscribe()
        }
    }, [])

    useEffect(() => {
        if (isLoading || !pathname) return

        if (isExempt(pathname)) {
            // If maintenance is OFF, kick them out of maintenance page
            if (pathname === '/maintenance' && !maintenanceMode) router.push('/')
            return
        }

        if (isBanned) {
            router.push('/banned')
        } else if (maintenanceMode) {
            router.push('/maintenance')
        }
    }, [maintenanceMode, isBanned, pathname, isLoading, router])

    return children
}
