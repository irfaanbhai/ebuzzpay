'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogOut, History, Shield, Lock, RotateCw, ChevronRight, Wallet, Banknote, X, CheckCircle, FileText, Clock, Plus, Trash2 } from 'lucide-react'
import { useSlotCycle } from '@/hooks/useSlotCycle'
import { clearQueryCache, useCachedQuery, useSessionUser } from '@/hooks/useCachedQuery'
import SlotCountdown from '@/components/SlotCountdown'

// Compact enough to stay on one line on a narrow phone
const formatNextCommission = (value) =>
    new Date(value).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    })

const UPI_PATTERN = /^[a-z0-9._-]+@[a-z]+$/

const EMPTY_WALLET = {
    balance: 0,
    locked_balance: 0,
    locked_until: null,
    withdrawal_in_process: 0,
    pending_commission: 0,
    payout_upi: null,
    payout_upis: [],
    withdrawals_today: 0,
    withdrawal_daily_limit: 3,
    today_earnings: 0,
}

export default function AssetsPage() {
    const user = useSessionUser()
    // Read once: the React Compiler would otherwise read user.id while user is still null
    const userId = user?.id

    // Withdrawal State
    const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false)
    const [withdrawalAmount, setWithdrawalAmount] = useState('')
    const [selectedUpi, setSelectedUpi] = useState('')
    const [newUpi, setNewUpi] = useState('')
    const [isAddingUpi, setIsAddingUpi] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
    const [error, setError] = useState('')

    const router = useRouter()
    const supabase = createClient()

    // Settles any slot commission that is due and returns every wallet
    // figure for this screen in one call
    const { data: wallet, loading: walletLoading, refresh: refreshWallet, mutate: mutateWallet } = useCachedQuery(
        userId ? `wallet:${userId}` : null,
        async () => {
            const { data, error } = await supabase.rpc('get_wallet_summary')
            if (error) throw error
            return data
        }
    )

    // Same timer as the Home page. When it hits zero, re-read the wallet so
    // the server credits the matured commission and the figures refresh.
    const { left: bonusLeft, refresh: refreshCycle } = useSlotCycle(user?.id, refreshWallet)

    // Coming back to the tab refreshes the wallet figures too
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshWallet()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [refreshWallet])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        clearQueryCache()
        router.push('/login')
    }

    const w = wallet || EMPTY_WALLET
    const balance = Number(w.balance || 0)
    const lockedBalance = Number(w.locked_balance || 0)
    const withdrawableBalance = Math.max(0, balance - lockedBalance)
    const inProcess = Number(w.withdrawal_in_process || 0)
    const pendingCommission = Number(w.pending_commission || 0)
    const todayEarnings = Number(w.today_earnings || 0)
    const withdrawalDailyLimit = Number(w.withdrawal_daily_limit || 3)
    const withdrawalsLeft = Math.max(0, withdrawalDailyLimit - Number(w.withdrawals_today || 0))
    const savedUpis = Array.isArray(w.payout_upis) ? w.payout_upis : []

    const openWithdrawModal = () => {
        setError('')
        setNewUpi('')
        setIsAddingUpi(savedUpis.length === 0)
        setSelectedUpi(savedUpis.includes(w.payout_upi) ? w.payout_upi : (savedUpis[0] || ''))
        setIsWithdrawModalOpen(true)
        refreshWallet()
    }

    const saveUpi = async () => {
        const upi = newUpi.trim().toLowerCase()
        if (!UPI_PATTERN.test(upi)) {
            setError('Invalid UPI ID format. Example: 9876543210@paytm')
            return
        }
        setError('')
        if (!savedUpis.includes(upi)) {
            const { error: insertError } = await supabase.from('user_payout_upis').insert({ user_id: userId, upi_id: upi })
            if (insertError && insertError.code !== '23505') {
                setError(insertError.message)
                return
            }
            mutateWallet((prev) => ({ ...(prev || EMPTY_WALLET), payout_upis: [...savedUpis, upi] }))
        }
        setSelectedUpi(upi)
        setNewUpi('')
        setIsAddingUpi(false)
    }

    const removeUpi = async (upi) => {
        const { error: deleteError } = await supabase.from('user_payout_upis').delete().eq('user_id', userId).eq('upi_id', upi)
        if (deleteError) {
            setError(deleteError.message)
            return
        }
        const rest = savedUpis.filter((u) => u !== upi)
        mutateWallet((prev) => ({ ...(prev || EMPTY_WALLET), payout_upis: rest }))
        if (selectedUpi === upi) setSelectedUpi(rest[0] || '')
        if (rest.length === 0) setIsAddingUpi(true)
    }

    const handleWithdrawal = async (e) => {
        e.preventDefault()
        setError('')
        setIsProcessing(true)

        try {
            const amount = parseFloat(withdrawalAmount)
            // A UPI typed in but not saved yet is used as well
            const upi = (isAddingUpi && newUpi.trim() ? newUpi : selectedUpi).trim().toLowerCase()

            if (isNaN(amount) || amount <= 0) {
                throw new Error('Please enter a valid amount')
            }
            if (amount > balance) {
                throw new Error('Insufficient balance')
            }
            if (!upi) {
                throw new Error('Please add or select the UPI ID to receive the money.')
            }
            if (!UPI_PATTERN.test(upi)) {
                throw new Error('Invalid UPI ID format. Example: 9876543210@paytm')
            }
            if (withdrawalsLeft <= 0) {
                throw new Error(`You can make only ${withdrawalDailyLimit} withdrawals per day. Try again tomorrow.`)
            }
            if (amount > withdrawableBalance) {
                throw new Error(`₹${lockedBalance.toFixed(2)} from your INR deposit is locked for its first 24 hours${w.locked_until ? ` (unlocks ${formatNextCommission(w.locked_until)})` : ''}. You can withdraw up to ₹${withdrawableBalance.toFixed(2)} now.`)
            }

            // Server re-checks the time window, daily limit, INR lock and UPI ID,
            // and takes the amount out of the wallet until the admin decides
            const { error: txError } = await supabase.rpc('request_withdrawal', { p_amount: amount, p_upi_id: upi })
            if (txError) throw txError

            setIsWithdrawModalOpen(false)
            setIsSuccessModalOpen(true)
            setWithdrawalAmount('')
            refreshWallet()
            refreshCycle()
        } catch (err) {
            setError(err.message)
        } finally {
            setIsProcessing(false)
        }
    }

    const menuItems = [
        { name: 'Deposit', icon: Wallet, color: 'text-navy-300', action: () => router.push('/deposit') },
        { name: 'Withdrawal', icon: Banknote, color: 'text-purple-400', action: openWithdrawModal },
        { name: 'Quota History', icon: History, color: 'text-[var(--text-muted)]', action: () => router.push('/history/quota') },
        { name: 'Deposit History', icon: RotateCw, color: 'text-emerald-400', action: () => router.push('/history/deposit') },
        { name: 'Withdrawal History', icon: RotateCw, color: 'text-red-400', action: () => router.push('/history/withdrawal') },
        { name: 'Support Center', icon: Shield, color: 'text-amber-400', action: () => router.push('/support') },
        { name: 'Terms & Conditions', icon: FileText, color: 'text-navy-300', action: () => router.push('/terms') },
        { name: 'Payment Pin', icon: Lock, color: 'text-[var(--text-muted)]', action: () => router.push('/profile/security') },
        { name: 'Change Password', icon: Lock, color: 'text-navy-300', action: () => router.push('/profile/security') },
        { name: 'Version Update', icon: RotateCw, color: 'text-navy-400', action: () => alert('Latest Version: 1.0.2') },
    ]

    return (
        <div className="relative min-h-screen pb-28">
            {/* Header */}
            <div className="glow-navy relative rounded-b-3xl bg-gradient-to-br from-navy-700 via-navy-900 to-black p-4 text-center text-white sm:p-6">
                <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-navy-400/20 blur-3xl" />
                <h1 className="relative z-10 mb-4 text-lg font-bold sm:mb-6 sm:text-xl">Assets</h1>

                <div className="relative z-10 mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm sm:gap-4 sm:p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white/20 bg-gradient-to-br from-navy-300 to-navy-600 text-base font-bold text-white sm:h-12 sm:w-12 sm:text-xl">
                        {user?.email ? user.email[0].toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium sm:text-base">{user?.email || '\u00a0'}</p>
                        <p className="truncate text-xs text-navy-50/60 sm:text-sm">ID: {user ? user.id.slice(0, 8) : '—'}</p>
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
                            <span className={`truncate ${walletLoading ? 'animate-pulse text-white/40' : ''}`}>{balance.toFixed(2)}</span>
                        </p>
                        <p className="mt-1 text-[10px] uppercase leading-tight tracking-wide text-[var(--text-muted)] sm:text-xs">Wallet Balance</p>
                    </div>
                    <div className="relative z-10 min-w-0 pl-3 sm:pl-6">
                        <p className="flex items-baseline text-2xl font-bold tabular-nums text-emerald-400 sm:text-3xl">
                            <span className="mr-0.5 shrink-0 text-base sm:mr-1 sm:text-lg">₹</span>
                            <span className={`truncate ${walletLoading ? 'animate-pulse text-emerald-400/40' : ''}`}>{todayEarnings.toFixed(2)}</span>
                        </p>
                        <p className="mt-1 text-[10px] uppercase leading-tight tracking-wide text-[var(--text-muted)] sm:text-xs">Today&apos;s Earning</p>
                    </div>
                </div>

                <div className="mt-3 rounded-2xl border border-navy-400/30 bg-navy-500/10 px-3 py-3 sm:px-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <Clock className={`h-4 w-4 shrink-0 ${bonusLeft ? 'text-navy-300' : 'text-white/40'}`} />
                            <p className="truncate text-xs font-medium text-navy-100 sm:text-sm">Slot bonus (5%) in</p>
                        </div>
                        <SlotCountdown left={bonusLeft} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/10 pt-2">
                        <p className="min-w-0 text-[10px] leading-relaxed text-[var(--text-dim)]">
                            {bonusLeft
                                ? 'You get 5% of your wallet every 24 hours. A deposit restarts the timer; withdrawing lowers the amount but the timer keeps running.'
                                : 'Timer starts when your slot purchase is approved.'}
                        </p>
                        {pendingCommission > 0 && (
                            <span className="shrink-0 text-xs font-bold tabular-nums text-navy-300">₹{pendingCommission.toFixed(2)}</span>
                        )}
                    </div>
                </div>

                {lockedBalance > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-3 text-xs sm:px-4">
                        <span className="min-w-0 text-amber-200/90">
                            INR deposit locked for 24h{w.locked_until ? ` · unlocks ${formatNextCommission(w.locked_until)}` : ''}
                        </span>
                        <span className="shrink-0 font-bold tabular-nums text-amber-300">₹{lockedBalance.toFixed(2)}</span>
                    </div>
                )}

                {inProcess > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-purple-400/25 bg-purple-500/10 px-3 py-3 text-xs sm:px-4">
                        <span className="min-w-0 text-purple-200/90">Withdrawal in process</span>
                        <span className="shrink-0 font-bold tabular-nums text-purple-300">₹{inProcess.toFixed(2)}</span>
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
                                        <span className="shrink-0 font-bold tabular-nums text-white">₹{balance.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-2 text-[var(--text-muted)]">
                                        <span className="min-w-0">Locked (INR deposit, first 24h)</span>
                                        <span className="shrink-0 font-bold tabular-nums text-amber-400">₹{lockedBalance.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-2 border-t border-white/10 pt-1.5 text-[var(--text-muted)]">
                                        <span className="min-w-0">Withdrawable</span>
                                        <span className="shrink-0 font-bold tabular-nums text-emerald-400">₹{withdrawableBalance.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-2 text-[var(--text-muted)]">
                                        <span className="min-w-0">Withdrawals left today</span>
                                        <span className={`shrink-0 font-bold tabular-nums ${withdrawalsLeft > 0 ? 'text-white' : 'text-red-400'}`}>{withdrawalsLeft} / {withdrawalDailyLimit}</span>
                                    </div>
                                </div>

                                {/* Payout UPI: any saved ID, or add a new one */}
                                <div className="mt-4">
                                    <label className="mb-2 block text-sm font-medium text-[var(--text-muted)]">Receive on UPI ID</label>
                                    <div className="space-y-2">
                                        {savedUpis.map((upi) => (
                                            <div
                                                key={upi}
                                                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${selectedUpi === upi && !isAddingUpi ? 'border-purple-400/60 bg-purple-500/15' : 'border-white/10 bg-white/5'}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => { setSelectedUpi(upi); setIsAddingUpi(false) }}
                                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                                >
                                                    <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${selectedUpi === upi && !isAddingUpi ? 'border-purple-300 bg-purple-400' : 'border-white/30'}`} />
                                                    <span className="min-w-0 truncate font-semibold text-white">{upi}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removeUpi(upi)}
                                                    aria-label={`Remove ${upi}`}
                                                    className="shrink-0 text-[var(--text-dim)] hover:text-red-400"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}

                                        {isAddingUpi ? (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={newUpi}
                                                    onChange={(e) => setNewUpi(e.target.value.toLowerCase().trim())}
                                                    placeholder="e.g. 9876543210@paytm"
                                                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={saveUpi}
                                                    disabled={!newUpi}
                                                    className="btn-navy shrink-0 rounded-xl px-4 text-xs font-bold disabled:opacity-60"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => setIsAddingUpi(true)}
                                                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 py-2.5 text-xs font-bold text-navy-300 hover:bg-white/5"
                                            >
                                                <Plus className="h-4 w-4" /> Add another UPI ID
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <p className="mt-3 text-xs leading-relaxed text-[var(--text-dim)]">
                                    Maximum {withdrawalDailyLimit} withdrawal requests per day. Rejected requests also count.
                                </p>

                                {lockedBalance > 0 && (
                                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-300/90">
                                        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <span className="min-w-0">
                                            ₹{lockedBalance.toFixed(2)} from your INR deposit is locked for its first 24 hours
                                            {w.locked_until ? ` and unlocks at ${formatNextCommission(w.locked_until)}` : ''}. USDT deposits are never locked.
                                        </span>
                                    </p>
                                )}

                                {pendingCommission > 0 && (
                                    <p className="mt-2 text-xs leading-relaxed text-amber-300/90">
                                        Your 5% bonus keeps running on what stays in your wallet. Withdrawing everything stops it.
                                    </p>
                                )}

                                <p className="mt-2 text-xs leading-relaxed text-[var(--text-dim)]">
                                    The amount leaves your wallet when you submit. If the request is rejected, it is returned to your wallet.
                                </p>
                            </div>

                            {error && (
                                <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-300 sm:text-sm">
                                    <div className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                                    <span className="min-w-0">{error}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isProcessing || withdrawalsLeft <= 0}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-purple-700 py-3.5 font-bold text-white shadow-[0_10px_30px_-8px_rgba(168,85,247,0.6)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {isProcessing ? (
                                    <>Processing...</>
                                ) : withdrawalsLeft <= 0 ? (
                                    <>Daily limit reached</>
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
                            Your withdrawal request is in processing and will be completed within 24 hours. The amount is held from your wallet and returned if the request is rejected.
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
