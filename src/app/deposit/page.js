'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { QRCodeCanvas } from 'qrcode.react'

// Minimum deposit, and the default INR bonus paid per 1 USDT.
// Both the rate and the bonus are overridable from the admin Settings tab.
const MIN_USDT = 10
const DEFAULT_RATE = 102.0
const DEFAULT_BONUS_PER_USDT = 3

export default function DepositPage() {
    const router = useRouter()

    const [rate, setRate] = useState(DEFAULT_RATE)
    const [bonusPerUsdt, setBonusPerUsdt] = useState(DEFAULT_BONUS_PER_USDT)

    const [usdtAmount, setUsdtAmount] = useState('')
    const [amountError, setAmountError] = useState('')

    // 1: enter amount, 2: pick chain / pay / submit hash
    const [step, setStep] = useState(1)
    const [selectedChain, setSelectedChain] = useState('')
    const [txHash, setTxHash] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Admin addresses (Placeholders as requested)
    const TRC20_ADDRESS = "TR3aSADssGoD682MvUC5vgZeaX2qWnkWkD"
    const BEP20_ADDRESS = "0x31A1F4c298dc3F1024107e2868bA0fE4AEcCAaF5"

    useEffect(() => {
        const fetchSettings = async () => {
            const supabase = createClient()

            const { data: rateValue } = await supabase.rpc('get_admin_setting', { setting_key: 'usdt_rate' })
            if (rateValue && !isNaN(parseFloat(rateValue))) setRate(parseFloat(rateValue))

            const { data: bonusValue } = await supabase.rpc('get_admin_setting', { setting_key: 'usdt_bonus_per_unit' })
            if (bonusValue && !isNaN(parseFloat(bonusValue))) setBonusPerUsdt(parseFloat(bonusValue))
        }
        fetchSettings()
    }, [])

    // 1 USDT -> `rate` INR, plus a flat `bonusPerUsdt` INR bonus for every USDT
    const usdtNum = parseFloat(usdtAmount) || 0
    const inrValue = usdtNum * rate
    const bonusInr = usdtNum * bonusPerUsdt
    const totalInr = inrValue + bonusInr

    const handleInvest = () => {
        if (!usdtAmount || usdtNum <= 0) {
            setAmountError('Please enter a valid amount')
            return
        }
        if (usdtNum < MIN_USDT) {
            setAmountError(`Minimum deposit is ${MIN_USDT} USDT`)
            return
        }
        setAmountError('')
        setStep(2)
    }

    const handleCopyAddress = (address) => {
        navigator.clipboard.writeText(address)
        alert("Address copied to clipboard!")
    }

    const confirmDeposit = async () => {
        if (!txHash) return alert("Please enter the transaction hash")
        if (usdtNum < MIN_USDT) return alert(`Minimum deposit is ${MIN_USDT} USDT`)

        setIsSubmitting(true)
        try {
            const supabase = createClient()

            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return router.push('/login')

            const { error } = await supabase.from('transactions').insert({
                user_id: user.id,
                // `amount` is the paid-for INR value; the bonus is tracked
                // separately so it can be credited as locked money.
                amount: parseFloat(inrValue.toFixed(2)),
                bonus_amount: parseFloat(bonusInr.toFixed(2)),
                usdt_amount: usdtNum,
                currency: 'USDT',
                chain: selectedChain,
                type: 'deposit',
                status: 'pending',
                utr: txHash,
                payment_method: `crypto-${selectedChain}`
            })

            if (error) throw error

            alert("Deposit submitted successfully! Please wait for approval.")
            router.push('/assets')

        } catch (e) {
            console.error(e)
            alert("Error submitting deposit: " + e.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const fmt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    return (
        <div className="min-h-screen pb-28">
            {/* Header */}
            <div className="glass sticky top-0 z-10 px-5 py-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-bold text-white">USDT Deposit</h1>
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-navy-400/30 bg-navy-500/15 font-bold text-navy-300">
                        ?
                    </div>
                </div>
            </div>

            <div className="p-4">
                {step === 1 && (
                    <div className="anim-slide-up space-y-4">
                        {/* Amount + live rate */}
                        <div className="flex gap-3">
                            <div className="glass flex flex-1 items-center rounded-2xl px-4 py-3">
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    value={usdtAmount}
                                    onChange={(e) => {
                                        setUsdtAmount(e.target.value)
                                        if (amountError) setAmountError('')
                                    }}
                                    min={MIN_USDT}
                                    step="0.01"
                                    placeholder="0"
                                    className="w-full min-w-0 flex-1 bg-transparent text-lg font-bold text-white outline-none"
                                />
                                <span className="ml-2 shrink-0 text-sm font-semibold text-[var(--text-muted)]">USDT</span>
                            </div>
                            <div className="flex shrink-0 items-center rounded-2xl border border-navy-400/30 bg-navy-500/10 px-4 text-sm font-bold text-amber-400">
                                1 USDT = {rate.toFixed(1)} INR
                            </div>
                        </div>

                        {amountError && (
                            <p className="ml-1 text-xs font-medium text-red-400">{amountError}</p>
                        )}

                        {/* Breakdown */}
                        <div className="glass space-y-3 rounded-2xl p-5">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-[var(--text-muted)]">Value</span>
                                <span className="font-semibold text-white">{fmt(inrValue)} INR</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-[var(--text-muted)]">
                                    Estimated bonus
                                    <span className="ml-1 text-[10px] text-[var(--text-dim)]">
                                        (₹{bonusPerUsdt}/USDT)
                                    </span>
                                </span>
                                <span className="font-semibold text-emerald-400">{fmt(bonusInr)} INR</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-white/10 pt-3">
                                <span className="font-bold text-white">You will receive</span>
                                <span className="text-lg font-bold text-amber-400">{fmt(totalInr)} INR</span>
                            </div>
                        </div>

                        {/* Notes */}
                        <div className="space-y-2 px-1 text-xs leading-relaxed text-red-400/90">
                            <p>* Minimum deposit is {MIN_USDT} USDT.</p>
                            <p>* Each address is valid for 30 minutes, please do not save this address</p>
                            <p>* After the recharge is completed, please wait for 3-5 minutes for the deposit to arrive</p>
                            <p className="text-[var(--text-dim)]">
                                * The bonus is credited as locked balance — put it on a slot to make it withdrawable.
                            </p>
                        </div>

                        <button
                            onClick={handleInvest}
                            className="btn-navy w-full rounded-xl py-3.5 text-lg font-bold"
                        >
                            Invest
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="anim-slide-up space-y-6">
                        <div className="rounded-xl border border-navy-400/30 bg-navy-500/10 p-4 text-center">
                            <p className="mb-1 text-lg font-bold text-white">Pay: {usdtAmount} USDT</p>
                            <p className="text-sm font-medium text-navy-300">
                                Get: ₹{fmt(totalInr)}{' '}
                                <span className="text-xs text-[var(--text-dim)]">
                                    (₹{fmt(inrValue)} + ₹{fmt(bonusInr)} bonus)
                                </span>
                            </p>
                        </div>

                        <h3 className="text-center text-lg font-bold text-white">Select Network</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setSelectedChain('TRC20')}
                                className={`rounded-xl border-2 p-4 transition-all ${selectedChain === 'TRC20' ? 'border-navy-400 bg-navy-500/15 text-white' : 'border-white/10 bg-white/5 text-[var(--text-muted)]'}`}
                            >
                                <div className="mb-1 text-xl font-bold">TRC20</div>
                                <div className="text-xs opacity-75">Tron Network</div>
                            </button>
                            <button
                                onClick={() => setSelectedChain('BEP20')}
                                className={`rounded-xl border-2 p-4 transition-all ${selectedChain === 'BEP20' ? 'border-navy-400 bg-navy-500/15 text-white' : 'border-white/10 bg-white/5 text-[var(--text-muted)]'}`}
                            >
                                <div className="mb-1 text-xl font-bold">BEP20</div>
                                <div className="text-xs opacity-75">BSC Network</div>
                            </button>
                        </div>

                        {selectedChain && (
                            <div className="anim-pop mt-6 space-y-4 text-center">
                                <div className="inline-block rounded-xl border border-white/10 bg-white p-4 shadow-inner">
                                    <QRCodeCanvas
                                        value={selectedChain === 'TRC20' ? TRC20_ADDRESS : BEP20_ADDRESS}
                                        size={180}
                                        level={"H"}
                                        includeMargin={true}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Deposit Address ({selectedChain})</p>
                                    <div
                                        onClick={() => handleCopyAddress(selectedChain === 'TRC20' ? TRC20_ADDRESS : BEP20_ADDRESS)}
                                        className="flex cursor-pointer items-center justify-center gap-2 break-all rounded-lg border border-white/10 bg-white/5 p-3 font-mono text-xs text-white transition-colors hover:bg-white/10"
                                    >
                                        {selectedChain === 'TRC20' ? TRC20_ADDRESS : BEP20_ADDRESS}
                                    </div>
                                    <p className="text-[10px] text-navy-300">Tap address to copy</p>
                                </div>

                                <div className="border-t border-white/10 pt-4">
                                    <label className="mb-2 block text-sm font-medium text-[var(--text-muted)]">Transaction Hash</label>
                                    <input
                                        type="text"
                                        value={txHash}
                                        onChange={(e) => setTxHash(e.target.value)}
                                        placeholder="Enter transaction hash"
                                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                                    />
                                </div>

                                <button
                                    onClick={confirmDeposit}
                                    disabled={isSubmitting}
                                    className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-700 py-3.5 text-lg font-bold text-white shadow-[0_10px_30px_-8px_rgba(16,185,129,0.6)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Verifying...' : 'Submit Deposit'}
                                </button>
                            </div>
                        )}

                        <button
                            onClick={() => setStep(1)}
                            className="mx-auto block text-sm text-[var(--text-dim)] hover:text-[var(--text-muted)]"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
