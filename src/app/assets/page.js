'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { LogOut, History, Shield, Lock, RotateCw, ChevronRight, Wallet, Banknote, X, CheckCircle, FileText, Clock } from 'lucide-react'

// Compact enough to stay on one line on a narrow phone
const formatNextCommission = (value) =>
    new Date(value).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    })

const pad = (n) => String(n).padStart(2, '0')

const splitDuration = (ms) => {
    const diff = Math.max(0, ms)
    return {
        h: pad(Math.floor(diff / 3600000)),
        m: pad(Math.floor(diff / 60000) % 60),
        s: pad(Math.floor(diff / 1000) % 60),
    }
}

export default function AssetsPage() {
    const [user, setUser] = useState(null)
    const [profile, setProfile] = useState({ balance: 0.00, locked_balance: 0.00, payout_upi: null })
    const [todayEarnings, setTodayEarnings] = useState(0.00)
    const [pendingCommission, setPendingCommission] = useState(0.00)
    const [nextCommissionAt, setNextCommissionAt] = useState(null)
    // Maturity of the MOST RECENT slot purchase, so buying again restarts the countdown
    const [bonusAt, setBonusAt] = useState(null)
    const [bonusLeft, setBonusLeft] = useState(null)

    // Withdrawal State
    const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false)
    const [withdrawalAmount, setWithdrawalAmount] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
    const [error, setError] = useState('')

    const router = useRouter()
    const supabase = createClient()

    const loadWallet = useCallback(async (userId) => {
        // Settles any slot commission that has passed its 24h wait
        // and returns the up-to-date wallet figures.
        const { data: summary } = await supabase.rpc('get_wallet_summary')
        if (summary) {
            setProfile((prev) => ({
                ...prev,
                balance: Number(summary.balance || 0),
                locked_balance: Number(summary.locked_balance || 0),
                payout_upi: summary.payout_upi
            }))
            setPendingCommission(Number(summary.pending_commission || 0))
            setNextCommissionAt(summary.next_commission_at)
        }

        // The latest slot still waiting out its 24 hours. Taking the newest
        // (not the earliest) is what makes a fresh purchase restart the timer.
        const { data: latestSlot } = await supabase
            .from('slot_commissions')
            .select('mature_at')
            .is('credited_at', null)
            .order('mature_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        setBonusAt(latestSlot?.mature_at ?? null)

        // Fetch Today's Earnings
        const { data: earnings } = await supabase.rpc('get_today_earnings', { target_user_id: userId })
        if (earnings !== null) setTodayEarnings(earnings)
    }, [supabase])

    useEffect(() => {
        const getData = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                setUser(user)
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single()

                if (profile) setProfile(profile)

                await loadWallet(user.id)
            } else {
                router.push('/login')
            }
        }
        getData()
    }, [router, supabase, loadWallet])

    // Live countdown to the bonus. Re-reads the wallet once it hits zero so
    // the server credits the matured commission and the figures refresh.
    useEffect(() => {
        if (!bonusAt || !user) {
            setBonusLeft(null)
            return
        }

        const target = new Date(bonusAt).getTime()
        let settled = false

        const tick = () => {
            const diff = target - Date.now()
            setBonusLeft(splitDuration(diff))
            if (diff <= 0 && !settled) {
                settled = true
                loadWallet(user.id)
            }
        }

        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [bonusAt, user, loadWallet])

    // Coming back to the tab after buying a slot picks up the new timer
    useEffect(() => {
        if (!user) return
        const onVisible = () => {
            if (document.visibilityState === 'visible') loadWallet(user.id)
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [user, loadWallet])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.push('/login')
    }

    const lockedBalance = Number(profile.locked_balance || 0)
    const withdrawableBalance = Math.max(0, Number(profile.balance || 0) - lockedBalance)

    const handleWithdrawal = async (e) => {
        e.preventDefault()
        setError('')
        setIsProcessing(true)

        try {
            const amount = parseFloat(withdrawalAmount)
            if (isNaN(amount) || amount <= 0) {
                throw new Error('Please enter a valid amount')
            }
            if (amount > profile.balance) {
                throw new Error('Insufficient balance')
            }
            if (!profile.payout_upi) {
                throw new Error('Buy a slot first. Withdrawals are paid only to the UPI ID you deposited from.')
            }
            if (amount > withdrawableBalance) {
                throw new Error(`₹${lockedBalance.toFixed(2)} of your balance has not been used on a slot yet. Put it on a slot before withdrawing.`)
            }

            // Server re-checks the locked balance and the registered UPI ID
            const { error: txError } = await supabase.rpc('request_withdrawal', { p_amount: amount })

            if (txError) throw txError

            // Determine if we need to deduct locally for immediate UI update (optional, relying on re-fetch is safer usually but user wants generic "processing" msg)
            // For now, just show the success message
            setIsWithdrawModalOpen(false)
            setIsSuccessModalOpen(true)
            setWithdrawalAmount('')

            // Refresh profile to show updated balance if backend trigger/logic runs immediately (unlikely if pending)
            const { data: updatedProfile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single()
            if (updatedProfile) setProfile(updatedProfile)


        } catch (err) {
            setError(err.message)
        } finally {
            setIsProcessing(false)
        }
    }

    const menuItems = [
        { name: 'Deposit', icon: Wallet, color: 'text-navy-300', action: () => router.push('/deposit') },
        { name: 'Withdrawal', icon: Banknote, color: 'text-purple-400', action: () => setIsWithdrawModalOpen(true) }, // Added Withdrawal Button
        { name: 'Quota History', icon: History, color: 'text-[var(--text-muted)]', action: () => router.push('/history/quota') },
        { name: 'Deposit History', icon: RotateCw, color: 'text-emerald-400', action: () => router.push('/history/deposit') },
        { name: 'Withdrawal History', icon: RotateCw, color: 'text-red-400', action: () => router.push('/history/withdrawal') },
        { name: 'Support Center', icon: Shield, color: 'text-amber-400', action: () => router.push('/support') },
        { name: 'Terms & Conditions', icon: FileText, color: 'text-navy-300', action: () => router.push('/terms') },
        { name: 'Payment Pin', icon: Lock, color: 'text-[var(--text-muted)]', action: () => router.push('/profile/security') },
        { name: 'Change Password', icon: Lock, color: 'text-navy-300', action: () => router.push('/profile/security') },
        { name: 'Version Update', icon: RotateCw, color: 'text-navy-400', action: () => alert('Latest Version: 1.0.2') },
    ]

    if (!user) return null

    return (
        <div className="relative min-h-screen pb-28">
            {/* Header */}
            <div className="glow-navy relative rounded-b-3xl bg-gradient-to-br from-navy-700 via-navy-900 to-black p-4 text-center text-white sm:p-6">
                <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-navy-400/20 blur-3xl" />
                <h1 className="relative z-10 mb-4 text-lg font-bold sm:mb-6 sm:text-xl">Assets</h1>

                <div className="relative z-10 mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm sm:gap-4 sm:p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white/20 bg-gradient-to-br from-navy-300 to-navy-600 text-base font-bold text-white sm:h-12 sm:w-12 sm:text-xl">
                        {user.email ? user.email[0].toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium sm:text-base">{user.email}</p>
                        <p className="truncate text-xs text-navy-50/60 sm:text-sm">ID: {user.id.slice(0, 8)}</p>
                    </div>
                    <div className="shrink-0 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold leading-tight text-navy-700 shadow-sm sm:px-3 sm:text-xs">
                        Reward Ratio: 3
                    </div>
                </div>
            </div>

            {/* Balance Cards */}
            <div className="-mt-6 px-3 sm:px-4">
                <div className="glass-strong relative grid grid-cols-2 overflow-hidden rounded-2xl p-4 text-white shadow-xl sm:p-6">
                    {/* Decorative circle */}
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-navy-500/20 blur-2xl" />

                    <div className="relative z-10 min-w-0 border-r border-white/10 pr-3 sm:pr-6">
                        <p className="flex items-baseline text-2xl font-bold tabular-nums sm:text-3xl">
                            <span className="mr-0.5 shrink-0 text-base sm:mr-1 sm:text-lg">₹</span>
                            <span className="truncate">{profile.balance.toFixed(2)}</span>
                        </p>
                        <p className="mt-1 text-[10px] uppercase leading-tight tracking-wide text-[var(--text-muted)] sm:text-xs">Wallet Balance</p>
                    </div>
                    <div className="relative z-10 min-w-0 pl-3 sm:pl-6">
                        <p className="flex items-baseline text-2xl font-bold tabular-nums text-emerald-400 sm:text-3xl">
                            <span className="mr-0.5 shrink-0 text-base sm:mr-1 sm:text-lg">₹</span>
                            <span className="truncate">{todayEarnings.toFixed(2)}</span>
                        </p>
                        <p className="mt-1 text-[10px] uppercase leading-tight tracking-wide text-[var(--text-muted)] sm:text-xs">Today&apos;s Earning</p>
                    </div>
                </div>

                {bonusLeft && (
                    <div className="mt-3 rounded-2xl border border-navy-400/30 bg-navy-500/10 px-3 py-3 sm:px-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                                <Clock className="h-4 w-4 shrink-0 text-navy-300" />
                                <p className="truncate text-xs font-medium text-navy-100 sm:text-sm">Slot bonus (5%) in</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <span className="rounded-md bg-navy-500/25 px-1.5 py-0.5 text-xs font-bold tabular-nums text-navy-200">{bonusLeft.h}</span>
                                <span className="text-xs font-bold text-navy-300">:</span>
                                <span className="rounded-md bg-navy-500/25 px-1.5 py-0.5 text-xs font-bold tabular-nums text-navy-200">{bonusLeft.m}</span>
                                <span className="text-xs font-bold text-navy-300">:</span>
                                <span className="rounded-md bg-navy-500/25 px-1.5 py-0.5 text-xs font-bold tabular-nums text-navy-200">{bonusLeft.s}</span>
                            </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/10 pt-2">
                            <p className="min-w-0 text-[10px] leading-relaxed text-[var(--text-dim)]">
                                Credited 24 hours after your slot is approved. Buying again restarts the timer.
                                {nextCommissionAt && nextCommissionAt !== bonusAt
                                    ? ` Earlier slots land from ${formatNextCommission(nextCommissionAt)}.`
                                    : ''}
                            </p>
                            {pendingCommission > 0 && (
                                <span className="shrink-0 text-xs font-bold tabular-nums text-navy-300">₹{pendingCommission.toFixed(2)}</span>
                            )}
                        </div>
                    </div>
                )}

                {lockedBalance > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-3 text-xs sm:px-4">
                        <span className="min-w-0 text-amber-200/90">Locked until put on a slot</span>
                        <span className="shrink-0 font-bold tabular-nums text-amber-300">₹{lockedBalance.toFixed(2)}</span>
                    </div>
                )}

            </div>

            {/* Menu List */}
            <div className="mt-6 space-y-3 px-3 sm:px-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3">
                {menuItems.map((item) => (
                    <button
                        key={item.name}
                        onClick={item.action}
                        className="glass flex w-full items-center justify-between gap-3 rounded-2xl p-3 transition-all hover:bg-white/[0.07] active:scale-[0.98] sm:p-4"
                    >
                        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                            <div className={`shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 ${item.color}`}>
                                <item.icon className="h-5 w-5" />
                            </div>
                            <span className="truncate text-sm font-medium text-white/90">{item.name}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-dim)]" />
                    </button>
                ))}

                <button
                    onClick={handleSignOut}
                    className="glass mt-6 flex w-full items-center justify-between gap-3 rounded-2xl p-3 text-red-400 transition-colors hover:bg-red-500/10 sm:p-4 md:mt-0"
                >
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                        <div className="shrink-0 rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-400">
                            <LogOut className="h-5 w-5" />
                        </div>
                        <span className="truncate text-sm font-medium">Logout</span>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-dim)]" />
                </button>
            </div>

            {/* Withdrawal Modal */}
            {isWithdrawModalOpen && (
                <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
                    <div className="anim-pop glass-strong relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl p-5 shadow-2xl sm:p-6">
                        <button
                            onClick={() => setIsWithdrawModalOpen(false)}
                            className="absolute right-4 top-4 text-[var(--text-dim)] hover:text-white"
                        >
                            <X className="h-6 w-6" />
                        </button>

                        <div className="mb-5 text-center sm:mb-6">
                            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-purple-400/30 bg-purple-500/15 text-purple-300 sm:mb-4">
                                <Banknote className="h-6 w-6" />
                            </div>
                            <h2 className="text-lg font-bold text-white sm:text-xl">Withdraw Funds</h2>
                            <p className="mt-1 text-xs text-[var(--text-muted)] sm:text-sm">Enter amount to withdraw</p>
                        </div>

                        <form onSubmit={handleWithdrawal}>
                            <div className="mb-5 sm:mb-6">
                                <label className="mb-2 block text-sm font-medium text-[var(--text-muted)]">Amount</label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-medium text-[var(--text-muted)]">₹</span>
                                    <input
                                        type="number"
                                        value={withdrawalAmount}
                                        onChange={(e) => setWithdrawalAmount(e.target.value)}
                                        className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-8 pr-4 text-lg font-bold text-white transition-all focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                                        placeholder="0.00"
                                        min="1"
                                        step="0.01"
                                        required
                                    />
                                </div>
                                <div className="mt-3 space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
                                    <div className="flex justify-between gap-2 text-[var(--text-muted)]">
                                        <span className="min-w-0">Wallet Balance</span>
                                        <span className="shrink-0 font-bold tabular-nums text-white">₹{Number(profile.balance || 0).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-2 text-[var(--text-muted)]">
                                        <span className="min-w-0">Locked (not on a slot yet)</span>
                                        <span className="shrink-0 font-bold tabular-nums text-amber-400">₹{lockedBalance.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-2 border-t border-white/10 pt-1.5 text-[var(--text-muted)]">
                                        <span className="min-w-0">Withdrawable</span>
                                        <span className="shrink-0 font-bold tabular-nums text-emerald-400">₹{withdrawableBalance.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-2 border-t border-white/10 pt-1.5 text-[var(--text-muted)]">
                                        <span className="shrink-0">Payout UPI</span>
                                        <span className="min-w-0 truncate font-bold text-white">{profile.payout_upi || 'Not set'}</span>
                                    </div>
                                </div>

                                {lockedBalance > 0 && (
                                    <p className="mt-2 text-xs leading-relaxed text-amber-300/90">
                                        ₹{lockedBalance.toFixed(2)} was credited to you without a slot purchase. Buy a slot of that
                                        amount to unlock it for withdrawal.
                                    </p>
                                )}
                            </div>

                            {error && (
                                <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-300 sm:text-sm">
                                    <div className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                                    <span className="min-w-0">{error}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isProcessing}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-purple-700 py-3.5 font-bold text-white shadow-[0_10px_30px_-8px_rgba(168,85,247,0.6)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {isProcessing ? (
                                    <>Processing...</>
                                ) : (
                                    <>Submit Request</>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {isSuccessModalOpen && (
                <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
                    <div className="anim-pop glass-strong relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl p-6 text-center shadow-2xl sm:p-8">
                        <button
                            onClick={() => setIsSuccessModalOpen(false)}
                            className="absolute right-4 top-4 text-[var(--text-dim)] hover:text-white"
                        >
                            <X className="h-6 w-6" />
                        </button>

                        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/15 text-emerald-400">
                            <CheckCircle className="h-8 w-8" />
                        </div>

                        <h2 className="mb-2 text-xl font-bold text-white sm:text-2xl">Success!</h2>
                        <p className="mb-6 text-sm leading-relaxed text-[var(--text-muted)] sm:mb-8 sm:text-base">
                            Your withdrawal request is in processing and will be completed within 24 hours.
                        </p>

                        <button
                            onClick={() => setIsSuccessModalOpen(false)}
                            className="btn-navy w-full rounded-xl py-3.5 font-bold"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
