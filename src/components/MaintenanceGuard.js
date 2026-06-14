'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function MaintenanceGuard({ children }) {
    const [maintenanceMode, setMaintenanceMode] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const pathname = usePathname()
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        checkMaintenance()

        // Subscribe to changes in admin_settings
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

    useEffect(() => {
        const checkRedirect = async () => {
            // Allow admin, login, and maintenance page always
            if (pathname.startsWith('/admin') || pathname.startsWith('/login') || pathname === '/maintenance' || pathname === '/banned') {
                return
            }

            // BAN CHECK
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                // We need to check profile.is_banned
                // Ideally this should be a subscription or real-time, but fetch on nav is okay for now.
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('is_banned')
                    .eq('id', user.id)
                    .single()

                if (profile?.is_banned) {
                    // Redirect to banned page or show alert?
                    // Let's redirect to a simple '/banned' route or just force logout logic?
                    // User asked "they will marker banned".
                    // Let's redirect to '/banned'
                    if (pathname !== '/banned') {
                        router.push('/banned')
                    }
                    return
                }
            } else {
                // Not logged in, no ban check needed
            }

            if (maintenanceMode) {
                // Check if user is admin
                // The requirement is "set this website under maintenance".
                // Admin needs to access Admin Panel. Everyone else gets blocked.
                // The Admin Panel is at /admin.
                // So if pathname starts with /admin, we allow.
                // If maintenance is ON and user is NOT on /admin (and not /maintenance), redirect.

                // Wait, we need to allow LOGIN for Admin to get to Admin Panel? 
                // Yes, /login should be allowed.
                router.push('/maintenance')
            } else if (pathname === '/maintenance') {
                // If maintenance is OFF, kick them out of maintenance page
                router.push('/')
            }
        }

        if (!isLoading) {
            checkRedirect()
        }
    }, [maintenanceMode, pathname, isLoading])


    const checkMaintenance = async () => {
        try {
            const { data, error } = await supabase
                .from('admin_settings')
                .select('value')
                .eq('key', 'maintenance_mode')
                .single()

            if (data) {
                setMaintenanceMode(data.value === 'true')
            }
        } catch (error) {
            console.error('Error checking maintenance:', error)
        } finally {
            setIsLoading(false)
        }
    }

    // Don't block rendering while loading, just check in background/effect. 
    // Or do we want to BLOCK? Better to not block to avoid flicker, but might show content briefly.
    // Let's show children but redirect quickly.
    return children
}
