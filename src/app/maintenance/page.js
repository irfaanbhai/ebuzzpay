'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { AlertTriangle, Hammer } from 'lucide-react'

export default function MaintenancePage() {
    const [heading, setHeading] = useState('System Maintenance')
    const [description, setDescription] = useState('We are currently performing scheduled upgrades to improve your experience. Please check back soon.')
    const supabase = createClient()

    useEffect(() => {
        fetchContent()
    }, [])

    const fetchContent = async () => {
        const { data: h } = await supabase.from('admin_settings').select('value').eq('key', 'maintenance_heading').single()
        const { data: d } = await supabase.from('admin_settings').select('value').eq('key', 'maintenance_description').single()

        if (h) setHeading(h.value)
        if (d) setDescription(d.value)
    }

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
            <div className="glass-strong w-full max-w-md rounded-3xl p-8 shadow-2xl">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/30 bg-amber-500/15">
                    <Hammer className="h-8 w-8 text-amber-400" />
                </div>

                <h1 className="mb-3 text-2xl font-bold text-white">{heading}</h1>

                <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-left">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                    <p className="text-sm text-amber-200/90">{description}</p>
                </div>

                <p className="text-xs text-[var(--text-muted)]">
                    Expected completion time: <span className="font-semibold text-white/80">Soon</span>
                </p>
            </div>
        </div>
    )
}
