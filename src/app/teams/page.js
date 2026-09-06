'use client'

import { Users, Copy, Share2, Facebook, Send, QrCode } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useEffect, useState } from 'react'

export default function TeamsPage() {
    const [stats, setStats] = useState({
        total_commission: 0,
        commission_today: 0,
        commission_yesterday: 0,
        team_count: 0,
        level_b_count: 0,
        level_c_count: 0,
        today_new_team: 0,
        referral_earned: 0,
        referral_rate: 0,
        referral_limit: 10,
        referral_slots_left: 10
    })
    const [referralCode, setReferralCode] = useState('')
    const [loading, setLoading] = useState(true)
    const supabase = createClient()

    useEffect(() => {
        fetchTeamData()
    }, [])

    const fetchTeamData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Fetch Profile for referral code
        const { data: profile } = await supabase
            .from('profiles')
            .select('referral_code')
            .eq('id', user.id)
            .single()

        if (profile) setReferralCode(profile.referral_code)

        // Fetch Stats
        const { data: teamStats, error } = await supabase.rpc('get_team_stats', { query_user_id: user.id })

        if (teamStats) {
            setStats(teamStats)
        } else {
            console.error(error)
        }
        setLoading(false)
    }

    const copyToClipboard = () => {
        const link = `${window.location.origin}/register?ref=${referralCode}`
        navigator.clipboard.writeText(link)
        alert('Invitation link copied!')
    }

    return (
        <div className="min-h-screen pb-28">
            {/* Header */}
            <div className="glow-navy relative overflow-hidden rounded-b-[2rem] bg-gradient-to-br from-navy-700 via-navy-900 to-black p-6 pb-12 text-white">
                <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-navy-400/20 blur-3xl" />
                <div className="relative z-10">
                    <div className="mb-6 flex items-center justify-between">
                        <h1 className="text-xl font-bold">Team</h1>
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
                            <span>Support</span>
                        </div>
                    </div>

                    <div className="mb-2 flex items-center gap-2 opacity-90">
                        <div className="rounded bg-white/15 p-1">
                            <span className="text-xs font-bold">$</span>
                        </div>
                        <span className="text-sm font-medium">My Total Commission</span>
                    </div>
                    <h2 className="mb-6 text-4xl font-bold">₹ {stats.total_commission}</h2>

                    <div className="grid grid-cols-2 gap-y-4 text-sm opacity-90">
                        <div className="flex items-center justify-between pr-4">
                            <span>Commission Yesterday</span>
                            <span className="font-bold">{stats.commission_yesterday}</span>
                        </div>
                        <div className="flex items-center justify-between border-l border-white/15 pl-4">
                            <span>Team Count</span>
                            <span className="font-bold">{stats.team_count}</span>
                        </div>
                        <div className="flex items-center justify-between pr-4">
                            <span>Commission Today</span>
                            <span className="text-xs font-bold text-emerald-300">+{stats.commission_today}</span>
                        </div>
                        <div className="flex items-center justify-between border-l border-white/15 pl-4">
                            <span>Today New Team</span>
                            <span className="text-xs font-bold text-emerald-300">+{stats.today_new_team}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Invitation Link */}
            <div className="relative z-20 -mt-6 px-4">
                <div className="glass rounded-2xl p-5">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white/90">Invitation Link</h3>
                        <span className="rounded-full bg-navy-500/15 px-3 py-1 text-[10px] font-bold text-navy-300">
                            {stats.team_count} / {stats.referral_limit} invited
                        </span>
                    </div>
                    {stats.referral_slots_left === 0 && (
                        <p className="mb-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-2 text-xs text-amber-200/90">
                            You have reached the limit of {stats.referral_limit} referrals. New signups on your link will
                            not be linked to your team.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <div className="flex-1 truncate rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-[var(--text-muted)]">
                            {referralCode ? `${typeof window !== 'undefined' ? window.location.origin : ''}/register?ref=${referralCode}` : 'Loading...'}
                        </div>
                        <button
                            onClick={copyToClipboard}
                            className="btn-navy rounded-xl p-3"
                        >
                            <Copy className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Social Share */}
            <div className="mt-6 px-4">
                <h3 className="mb-4 text-sm font-semibold text-white/90">More Ways To Invite</h3>
                <div className="flex justify-between gap-2">
                    {[
                        { name: 'Facebook', icon: Facebook, color: 'text-navy-300' },
                        { name: 'Telegram', icon: Send, color: 'text-sky-300' },
                        { name: 'WhatsApp', icon: Share2, color: 'text-emerald-300' },
                        { name: 'QR Code', icon: QrCode, color: 'text-purple-300' },
                        { name: 'Share', icon: Share2, color: 'text-red-300' },
                    ].map((item) => (
                        <div key={item.name} className="flex flex-col items-center gap-2">
                            <button className={`glass flex h-12 w-12 items-center justify-center rounded-full ${item.color}`}>
                                <item.icon className="h-5 w-5" />
                            </button>
                            <span className="text-xs text-[var(--text-muted)]">{item.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Referral Reward Tiers */}
            <div className="mt-8 px-4">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-bold text-white">
                        <Users className="h-5 w-5 text-navy-300" /> Referral Rewards
                    </h3>
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                        Your rate: {Number(stats.referral_rate || 0).toFixed(2)}%
                    </span>
                </div>

                <div className="glass overflow-hidden rounded-2xl">
                    <div className="grid grid-cols-3 border-b border-white/10 p-4 text-xs font-semibold text-[var(--text-dim)]">
                        <div>Referrals</div>
                        <div className="text-center">Bonus Rate</div>
                        <div className="text-right">Status</div>
                    </div>
                    {[
                        { label: '1 - 5 users', rate: '0.10%', min: 1, max: 5 },
                        { label: '6 - 9 users', rate: '0.20%', min: 6, max: 9 },
                        { label: '10 users (max)', rate: '0.50%', min: 10, max: 10 },
                    ].map((row) => {
                        const active = stats.team_count >= row.min && stats.team_count <= row.max
                        return (
                            <div
                                key={row.label}
                                className={`grid grid-cols-3 items-center p-4 text-sm font-medium transition-colors ${active ? 'bg-navy-500/10' : ''}`}
                            >
                                <div className="font-semibold text-white">{row.label}</div>
                                <div className="rounded bg-navy-500/15 py-1 text-center text-xs font-bold text-navy-300">{row.rate}</div>
                                <div className="text-right text-xs text-[var(--text-muted)]">
                                    {active ? <span className="font-bold text-emerald-400">Active</span> : '—'}
                                </div>
                            </div>
                        )
                    })}
                </div>

                <div className="glass mt-4 rounded-2xl p-5">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm text-[var(--text-muted)]">Referral bonus earned</span>
                        <span className="font-bold text-emerald-400">₹ {Number(stats.referral_earned || 0).toFixed(2)}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[var(--text-dim)]">
                        You earn this rate on every slot your referrals buy, credited when their deposit is approved.
                        Bonus amounts must be put on a slot before they can be withdrawn. Maximum {stats.referral_limit} referrals per user.
                    </p>
                </div>
            </div>

            {/* Team Detail Table */}
            <div className="mt-8 px-4">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-bold text-white">
                        <Users className="h-5 w-5 text-navy-300" /> Team Detail
                    </h3>
                </div>

                <div className="glass overflow-hidden rounded-2xl">
                    <div className="grid grid-cols-2 border-b border-white/10 p-4 text-xs font-semibold text-[var(--text-dim)]">
                        <div>Level</div>
                        <div className="text-right">Count</div>
                    </div>
                    {[
                        { level: 'Level A (Direct)', count: stats.team_count },
                        { level: 'Level B', count: stats.level_b_count },
                        { level: 'Level C', count: stats.level_c_count },
                    ].map((row) => (
                        <div key={row.level} className="grid grid-cols-2 items-center p-4 text-sm font-medium transition-colors hover:bg-white/5">
                            <div className="font-semibold text-white">{row.level}</div>
                            <div className="text-right text-[var(--text-muted)]">{row.count}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
