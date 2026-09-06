'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Send, MessageCircle, FileText } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const DEFAULT_TELEGRAM_LINK = 'https://t.me/ZPayService'

// Accepts "+91 98765 43210", "919876543210" etc. and builds a wa.me link
const buildWhatsappLink = (number) => {
    const digits = (number || '').replace(/\D/g, '')
    if (!digits) return ''
    return `https://wa.me/${digits}`
}

export default function SupportPage() {
    const router = useRouter()
    const supabase = createClient()
    const [telegramLink, setTelegramLink] = useState(DEFAULT_TELEGRAM_LINK)
    const [whatsappNumber, setWhatsappNumber] = useState('')

    useEffect(() => {
        const fetchContacts = async () => {
            const { data: tg } = await supabase.rpc('get_admin_setting', { setting_key: 'telegram_link' })
            if (tg) setTelegramLink(tg)

            const { data: wa } = await supabase.rpc('get_admin_setting', { setting_key: 'whatsapp_number' })
            if (wa) setWhatsappNumber(wa)
        }
        fetchContacts()
    }, [supabase])

    const whatsappLink = buildWhatsappLink(whatsappNumber)

    return (
        <div className="min-h-screen pb-28">
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

                {whatsappLink && (
                    <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="glass flex items-center gap-4 rounded-2xl p-5 transition-all hover:bg-white/[0.07]"
                    >
                        <div className="rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 p-3 text-white shadow-[0_8px_20px_-8px_rgba(16,185,129,0.7)]">
                            <MessageCircle className="h-6 w-6" />
                        </div>
                        <div>
                            <h3 className="font-bold text-white">WhatsApp Support</h3>
                            <p className="text-sm text-[var(--text-muted)]">{whatsappNumber}</p>
                        </div>
                    </a>
                )}

                <button
                    onClick={() => router.push('/terms')}
                    className="glass flex w-full items-center gap-4 rounded-2xl p-5 text-left transition-all hover:bg-white/[0.07]"
                >
                    <div className="rounded-full border border-white/10 bg-white/5 p-3 text-navy-300">
                        <FileText className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-white">Terms &amp; Conditions</h3>
                        <p className="text-sm text-[var(--text-muted)]">Deposit, withdrawal and account rules</p>
                    </div>
                </button>

                <p className="px-2 pt-2 text-center text-xs leading-relaxed text-[var(--text-dim)]">
                    We never ask for your password or payment PIN. Use only the official links above.
                </p>
            </div>
        </div>
    )
}
