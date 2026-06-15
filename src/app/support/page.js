'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Send, MessageCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const DEFAULT_TELEGRAM_LINK = 'https://t.me/ZPayService'

export default function SupportPage() {
    const router = useRouter()
    const supabase = createClient()
    const [telegramLink, setTelegramLink] = useState(DEFAULT_TELEGRAM_LINK)

    useEffect(() => {
        const fetchTelegramLink = async () => {
            const { data } = await supabase.rpc('get_admin_setting', { setting_key: 'telegram_link' })
            if (data) setTelegramLink(data)
        }
        fetchTelegramLink()
    }, [supabase])

    return (
        <div className="min-h-screen">
            {/* Header */}
            <div className="glass sticky top-0 z-10 flex items-center gap-4 px-5 py-4">
                <button onClick={() => router.back()} className="text-[var(--text-muted)] transition-colors hover:text-white">
                    <ArrowLeft className="h-6 w-6" />
                </button>
                <h1 className="text-xl font-bold text-white">Support Center</h1>
            </div>

            <div className="space-y-4 p-6">
                <div className="glow-navy mb-8 rounded-3xl bg-gradient-to-br from-navy-600 via-navy-800 to-black p-6 text-center text-white">
                    <h2 className="mb-2 text-2xl font-bold">How can we help?</h2>
                    <p className="text-navy-50/80">Our team is available 24/7 to assist you.</p>
                </div>

                <a
                    href={telegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass flex items-center gap-4 rounded-2xl p-5 transition-all hover:bg-white/[0.07]"
                >
                    <div className="rounded-full bg-gradient-to-br from-navy-400 to-navy-700 p-3 text-white shadow-[0_8px_20px_-8px_rgba(51,94,201,0.7)]">
                        <Send className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-white">Telegram Support</h3>
                        <p className="text-sm text-[var(--text-muted)]">Official Channel</p>
                    </div>
                </a>
            </div>
        </div>
    )
}
