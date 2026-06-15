'use client'

import { Eye } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { QRCodeCanvas } from 'qrcode.react'

export default function DepositPage() {
    const router = useRouter()
    const [activeTab, setActiveTab] = useState('INR')

    // INR State (List/Filter)
    const [amounts, setAmounts] = useState([])
    const [page, setPage] = useState(1)
    const [activeRange, setActiveRange] = useState('All')

    // USDT State
    const [usdtAmount, setUsdtAmount] = useState('')
    const [usdtInrEquivalent, setUsdtInrEquivalent] = useState(0)

    const [RATE, setRate] = useState(102.0)
    const BONUS_RATE = 0.10
    const ACTIVITY_BONUS = 6.00

    // Fetch USDT rate from admin settings
    useEffect(() => {
        const fetchRate = async () => {
            const supabase = createClient()
            const { data } = await supabase.rpc('get_admin_setting', { setting_key: 'usdt_rate' })
            if (data && !isNaN(parseFloat(data))) setRate(parseFloat(data))
        }
        fetchRate()
    }, [])

    // USDT Calculations
    const calculatedInrFromUsdt = usdtAmount ? (parseFloat(usdtAmount) * RATE).toFixed(2) : '0'

    // INR Logic (Generate Amounts)
    const generateAmounts = () => {
        const count = 9
        const min = 25000
        const max = 100000
        const uniquePrices = new Set()

        while (uniquePrices.size < count) {
            const price = Math.floor(Math.random() * (max - min + 1)) + min
            uniquePrices.add(price)
        }

        const sortedPrices = Array.from(uniquePrices).sort((a, b) => a - b)

        return sortedPrices.map(price => {
            const income = (price * BONUS_RATE).toFixed(2)
            const quota = (price + parseFloat(income) + ACTIVITY_BONUS).toFixed(2)

            return {
                price: price.toFixed(2),
                income: income,
                activity: ACTIVITY_BONUS.toFixed(2),
                quota: quota
            }
        })
    }

    const ranges = ['All', '25k+', '30k+', '50k+', '80k+']

    const filteredAmounts = useMemo(() => {
        if (activeRange === 'All') return amounts;
        const min = parseInt(activeRange.replace('k+', '000'));
        return amounts.filter(item => parseFloat(item.price) >= min);
    }, [amounts, activeRange]);

    useEffect(() => {
        setPage(1)
    }, [activeRange])

    useEffect(() => {
        setAmounts(generateAmounts())
        const interval = setInterval(() => {
            setAmounts(generateAmounts())
        }, 10000)
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setPage((prev) => prev + 1)
                }
            },
            { threshold: 0.1 }
        )
        const trigger = document.getElementById('load-more-trigger')
        if (trigger) {
            observer.observe(trigger)
        }
        return () => {
            if (trigger) observer.unobserve(trigger)
        }
    }, [filteredAmounts])

    // USDT Logic
    const [usdtStep, setUsdtStep] = useState(1) // 1: Amount, 2: Chain/Address, 3: Hash
    const [selectedChain, setSelectedChain] = useState('')
    const [txHash, setTxHash] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Admin addresses (Placeholders as requested)
    const TRC20_ADDRESS = "TJVPaAuKRnHhMY56QGjPt2bcVySebqDAk1"
    const BEP20_ADDRESS = "0x54d3627E04997c5a0E32CEc79eeB6CcBD6369e62"

    const handleUsdtSubmit = async () => {
        if (!usdtAmount || parseFloat(usdtAmount) <= 0) return alert("Please enter a valid amount")
        setUsdtStep(2)
    }

    const handleChainSelect = (chain) => {
        setSelectedChain(chain)
    }

    const handleCopyAddress = (address) => {
        navigator.clipboard.writeText(address)
        alert("Address copied to clipboard!")
    }

    const confirmDeposit = async () => {
        if (!txHash) return alert("Please enter the transaction hash")

        setIsSubmitting(true)
        try {
            // Use Supabase client from top-level import
            const supabase = createClient()

            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return router.push('/login')

            const { error } = await supabase.from('transactions').insert({
                user_id: user.id,
                amount: parseFloat(usdtAmount),
                converted_amount: usdtInrEquivalent,
                currency: 'USDT',
                chain: selectedChain,
                type: 'deposit',
                status: 'pending',
                utr: txHash,
                payment_method: 'crypto'
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



    return (
        <div className="min-h-screen pb-28">
            {/* Header */}
            <div className="glass sticky top-0 z-10 px-5 py-4">
                <div className="mb-4 flex items-center justify-between">
                    <h1 className="text-xl font-bold text-white">Deposit</h1>
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-navy-400/30 bg-navy-500/15 font-bold text-navy-300">
                        ?
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('INR')}
                        className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${activeTab === 'INR' ? 'btn-navy' : 'border border-white/10 bg-white/5 text-[var(--text-muted)]'}`}
                    >
                        INR (disabled)
                    </button>
                    <button
                        onClick={() => setActiveTab('USDT')}
                        className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${activeTab === 'USDT' ? 'btn-navy' : 'border border-white/10 bg-white/5 text-[var(--text-muted)]'}`}
                    >
                        USDT
                    </button>
                </div>
            </div>

            {/* Content Container */}
            <div className="p-4">
                <div className="glass rounded-3xl p-6">
                    <div className="mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-2 font-medium text-[var(--text-muted)]">
                            <span>Quota</span>
                            <Eye className="h-4 w-4" />
                        </div>
                        <button className="text-sm font-bold text-navy-300">
                            How To Buy Quota
                        </button>
                    </div>

                    <div className="mb-6 text-center">
                        <h2 className="text-3xl font-black text-gradient">0.00 INR</h2>
                    </div>

                    {activeTab === 'INR' ? (
                        <>
                            {/* Range Selector */}
                            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2">
                                {ranges.map((range) => (
                                    <button
                                        key={range}
                                        onClick={() => setActiveRange(range)}
                                        className={`whitespace-nowrap rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${activeRange === range
                                            ? 'btn-navy'
                                            : 'border border-white/10 bg-white/5 text-[var(--text-muted)] hover:border-navy-400/40'
                                            }`}
                                    >
                                        {range}
                                    </button>
                                ))}
                            </div>

                            {/* List */}
                            <div className="mt-6 space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
                                {filteredAmounts.slice(0, page * 20).map((item, index) => (
                                    <div key={index} className="border-t border-white/5 py-4 first:pt-0">
                                        <div className="mb-2 flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-navy-400/30 bg-navy-500/15 font-bold text-navy-300">
                                                    ₹
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-lg font-bold text-white">{item.price} INR</span>
                                                    </div>
                                                    <div className="mt-1 text-xs text-[var(--text-dim)]">
                                                        Income: ₹ {item.income} (10.00%) <span className="text-[var(--text-dim)]">+6.00(Activity)</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <button
                                                    onClick={() => router.push(`/payment?amount=${item.price}`)}
                                                    className="btn-navy rounded-lg px-6 py-1.5 text-xs font-bold"
                                                >
                                                    Buy
                                                </button>
                                                <div className="mt-1 text-[10px] font-medium text-emerald-400">
                                                    Quota: + {item.quota}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {filteredAmounts.length === 0 && (
                                    <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                                        No amounts found in this range.
                                    </div>
                                )}

                                <div id="load-more-trigger" className="flex h-4 w-full items-center justify-center py-4">
                                    {filteredAmounts.length > page * 20 && <div className="animate-pulse text-xs text-[var(--text-dim)]">Loading more...</div>}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="pt-2">
                            {usdtStep === 1 && (
                                <>
                                    {/* Range Selector (Same as INR) */}
                                    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2">
                                        {ranges.map((range) => (
                                            <button
                                                key={range}
                                                onClick={() => setActiveRange(range)}
                                                className={`whitespace-nowrap rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${activeRange === range
                                                    ? 'btn-navy'
                                                    : 'border border-white/10 bg-white/5 text-[var(--text-muted)] hover:border-navy-400/40'
                                                    }`}
                                            >
                                                {range}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="mb-4 mt-6 flex gap-4">
                                        <div className="flex flex-1 items-center justify-center rounded-xl border border-navy-400/30 bg-navy-500/10 py-3 text-sm font-bold text-navy-300">
                                            Rate: 1 USDT = {RATE.toFixed(1)} INR
                                        </div>
                                    </div>

                                    {/* List (Adapted for USDT) */}
                                    <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
                                        {filteredAmounts.slice(0, page * 20).map((item, index) => {
                                            const usdtValue = (parseFloat(item.price) / RATE).toFixed(2)
                                            return (
                                                <div key={index} className="border-t border-white/5 py-4 first:pt-0">
                                                    <div className="mb-2 flex items-start justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-navy-400/30 bg-navy-500/15 font-bold text-navy-300">
                                                                $
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-lg font-bold text-white">{item.price} INR</span>
                                                                </div>
                                                                <div className="mt-1 text-xs font-bold text-navy-300">
                                                                    ≈ {usdtValue} USDT
                                                                </div>
                                                                <div className="mt-0.5 text-xs text-[var(--text-dim)]">
                                                                    Income: ₹ {item.income}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <button
                                                                onClick={() => {
                                                                    setUsdtAmount(usdtValue)
                                                                    setUsdtInrEquivalent(parseFloat(item.price))
                                                                    setUsdtStep(2)
                                                                }}
                                                                className="btn-navy rounded-lg px-6 py-1.5 text-xs font-bold"
                                                            >
                                                                Buy
                                                            </button>
                                                            <div className="mt-1 text-[10px] font-medium text-emerald-400">
                                                                Quota: + {item.quota}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}

                                        {filteredAmounts.length === 0 && (
                                            <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                                                No amounts found in this range.
                                            </div>
                                        )}

                                        <div className="flex h-4 w-full items-center justify-center py-4">
                                            {filteredAmounts.length > page * 20 && <div className="animate-pulse text-xs text-[var(--text-dim)]">Loading more...</div>}
                                        </div>
                                    </div>
                                </>
                            )}

                            {usdtStep === 2 && (
                                <div className="anim-slide-up space-y-6">
                                    <div className="rounded-xl border border-navy-400/30 bg-navy-500/10 p-4 text-center">
                                        <p className="mb-1 text-lg font-bold text-white">Pay: {usdtAmount} USDT</p>
                                        <p className="text-sm font-medium text-navy-300">Get: ₹{usdtInrEquivalent}</p>
                                    </div>
                                    <h3 className="text-center text-lg font-bold text-white">Select Network</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <button
                                            onClick={() => handleChainSelect('TRC20')}
                                            className={`rounded-xl border-2 p-4 transition-all ${selectedChain === 'TRC20' ? 'border-navy-400 bg-navy-500/15 text-white' : 'border-white/10 bg-white/5 text-[var(--text-muted)]'}`}
                                        >
                                            <div className="mb-1 text-xl font-bold">TRC20</div>
                                            <div className="text-xs opacity-75">Tron Network</div>
                                        </button>
                                        <button
                                            onClick={() => handleChainSelect('BEP20')}
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

                                            <button
                                                onClick={() => setUsdtStep(1)}
                                                className="mt-4 text-sm text-[var(--text-dim)] hover:text-[var(--text-muted)]"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
