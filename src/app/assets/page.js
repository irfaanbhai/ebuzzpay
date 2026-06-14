'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogOut, History, Shield, Lock, RotateCw, ChevronRight, Wallet, ArrowDownCircle, Banknote, X, CheckCircle } from 'lucide-react'

export default function AssetsPage() {
    const [user, setUser] = useState(null)
    const [profile, setProfile] = useState({ balance: 0.00 })
    const [todayEarnings, setTodayEarnings] = useState(0.00)

    // Withdrawal State
    const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false)
    const [withdrawalAmount, setWithdrawalAmount] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
    const [error, setError] = useState('')

    const router = useRouter()
    const supabase = createClient()

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

                // Fetch Today's Earnings
                const { data: earnings } = await supabase.rpc('get_today_earnings', { target_user_id: user.id })
                if (earnings !== null) setTodayEarnings(earnings)
            } else {
                router.push('/login')
            }
        }
        getData()
    }, [router, supabase])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.push('/login')
    }

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

            const { error: txError } = await supabase
                .from('transactions')
                .insert({
                    user_id: user.id,
                    amount: amount,
                    type: 'withdrawal',
                    status: 'pending',
                    payment_method: 'system',
                    utr: `WD_${Date.now()}_${Math.floor(Math.random() * 1000)}` // Generate placeholder UTR
                })

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
        { name: 'Payment Pin', icon: Lock, color: 'text-[var(--text-muted)]', action: () => router.push('/profile/security') },
        { name: 'Change Password', icon: Lock, color: 'text-navy-300', action: () => router.push('/profile/security') },
        { name: 'Version Update', icon: RotateCw, color: 'text-navy-400', action: () => alert('Latest Version: 1.0.2') },
    ]

    if (!user) return null

    return (
        <div className="relative min-h-screen pb-28">
            {/* Header */}
            <div className="glow-navy relative rounded-b-3xl bg-gradient-to-br from-navy-700 via-navy-900 to-black p-6 text-center text-white">
                <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-navy-400/20 blur-3xl" />
                <h1 className="relative z-10 mb-6 text-xl font-bold">Assets</h1>

                <div className="relative z-10 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20 bg-gradient-to-br from-navy-300 to-navy-600 text-xl font-bold text-white">
                        {user.email ? user.email[0].toUpperCase() : 'U'}
                    </div>
                    <div className="flex-1 text-left">
                        <p className="max-w-[150px] truncate font-medium">{user.email}</p>
                        <p className="text-sm text-navy-50/60">ID: {user.id.slice(0, 8)}</p>
                    </div>
                    <div className="rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-navy-700 shadow-sm">
                        Reward Ratio: 3
                    </div>
                </div>
            </div>

            {/* Balance Cards */}
            <div className="-mt-6 px-4">
                <div className="glass-strong relative flex items-center justify-between overflow-hidden rounded-2xl p-6 text-white shadow-xl">
                    {/* Decorative circle */}
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-navy-500/20 blur-2xl" />

                    <div className="relative z-10 w-1/2 border-r border-white/10 pr-4">
                        <p className="flex items-baseline text-3xl font-bold">
                            <span className="mr-1 text-lg">₹</span>{profile.balance.toFixed(2)}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">Wallet Balance</p>
                    </div>
                    <div className="relative z-10 w-1/2 pl-6">
                        <p className="text-3xl font-bold text-emerald-400">{todayEarnings.toFixed(2)}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">Today&apos;s Earning</p>
                    </div>
                </div>
            </div>

            {/* Menu List */}
            <div className="mt-6 space-y-3 px-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3">
                {menuItems.map((item) => (
                    <button
                        key={item.name}
                        onClick={item.action}
                        className="glass flex w-full items-center justify-between rounded-2xl p-4 transition-all hover:bg-white/[0.07] active:scale-[0.98]"
                    >
                        <div className="flex items-center gap-4">
                            <div className={`rounded-xl border border-white/10 bg-white/5 p-2 ${item.color}`}>
                                <item.icon className="h-5 w-5" />
                            </div>
                            <span className="text-sm font-medium text-white/90">{item.name}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-[var(--text-dim)]" />
                    </button>
                ))}

                <button
                    onClick={handleSignOut}
                    className="glass mt-6 flex w-full items-center justify-between rounded-2xl p-4 text-red-400 transition-colors hover:bg-red-500/10"
                >
                    <div className="flex items-center gap-4">
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-400">
                            <LogOut className="h-5 w-5" />
                        </div>
                        <span className="text-sm font-medium">Logout</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--text-dim)]" />
                </button>
            </div>

            {/* Withdrawal Modal */}
            {isWithdrawModalOpen && (
                <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="anim-pop glass-strong relative w-full max-w-sm rounded-3xl p-6 shadow-2xl">
                        <button
                            onClick={() => setIsWithdrawModalOpen(false)}
                            className="absolute right-4 top-4 text-[var(--text-dim)] hover:text-white"
                        >
                            <X className="h-6 w-6" />
                        </button>

                        <div className="mb-6 text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-purple-400/30 bg-purple-500/15 text-purple-300">
                                <Banknote className="h-6 w-6" />
                            </div>
                            <h2 className="text-xl font-bold text-white">Withdraw Funds</h2>
                            <p className="mt-1 text-sm text-[var(--text-muted)]">Enter amount to withdraw</p>
                        </div>

                        <form onSubmit={handleWithdrawal}>
                            <div className="mb-6">
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
                                <div className="mt-2 flex justify-between text-xs text-[var(--text-muted)]">
                                    <span>Available Balance: ₹{profile.balance.toFixed(2)}</span>
                                </div>
                            </div>

                            {error && (
                                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                                    <div className="h-1 w-1 rounded-full bg-red-400" />
                                    {error}
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
                <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="anim-pop glass-strong relative w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl">
                        <button
                            onClick={() => setIsSuccessModalOpen(false)}
                            className="absolute right-4 top-4 text-[var(--text-dim)] hover:text-white"
                        >
                            <X className="h-6 w-6" />
                        </button>

                        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/15 text-emerald-400">
                            <CheckCircle className="h-8 w-8" />
                        </div>

                        <h2 className="mb-2 text-2xl font-bold text-white">Success!</h2>
                        <p className="mb-8 text-[var(--text-muted)]">
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
