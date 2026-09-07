'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, Suspense, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, ChevronDown, ChevronRight, CheckCircle2, Lock } from 'lucide-react'

// Wrap logic in a separate component to use useSearchParams
function PaymentProcess() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const amount = searchParams.get('amount') || '0'
    const [openAccordion, setOpenAccordion] = useState('')
    const [utr, setUtr] = useState('')
    const [loading, setLoading] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const supabase = createClient()

    // ADMIN UPI ID
    const [adminUpi, setAdminUpi] = useState('mahawar-akash@ptyes') // Default fallback
    const ADMIN_NAME = "Admin Merchant"

    // Payer UPI: locked to the account after the first deposit
    const [payerUpi, setPayerUpi] = useState('')
    const [registeredUpi, setRegisteredUpi] = useState(null)

    useEffect(() => {
        const fetchUpi = async () => {
            const { data } = await supabase.rpc('get_admin_setting', { setting_key: 'admin_upi' })
            if (data) setAdminUpi(data)
        }
        fetchUpi()

        const fetchPayerUpi = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: profile } = await supabase
                .from('profiles')
                .select('payout_upi')
                .eq('id', user.id)
                .single()
            if (profile?.payout_upi) {
                setRegisteredUpi(profile.payout_upi)
                setPayerUpi(profile.payout_upi)
            }
        }
        fetchPayerUpi()
    }, [supabase])

    const generateDeepLink = (app) => {
        const url = `upi://pay?pa=${adminUpi}&pn=${ADMIN_NAME}&am=${amount}&cu=INR`
        // Note: For specific apps, deep links might vary slightly, but standard upi:// scheme works for most intent filters
        return url
    }

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text)
        alert('UPI ID Copied!')
    }

    const handleSubmit = async () => {
        if (!utr) {
            alert('Please enter UTR number')
            return
        }

        if (!payerUpi.trim()) {
            alert('Please enter the UPI ID you paid from')
            return
        }

        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                alert('Please login first')
                router.push('/login')
                return
            }

            // Deposits are accepted only from the UPI ID registered on the
            // account, and withdrawals are paid back to that same ID.
            const { error } = await supabase.rpc('submit_upi_deposit', {
                p_amount: parseFloat(amount),
                p_utr: utr,
                p_upi_id: payerUpi.trim().toLowerCase(),
                p_method: openAccordion || 'other'
            })

            if (error) throw error

            setSubmitted(true)
            setTimeout(() => {
                router.push('/deposit')
            }, 3000)

        } catch (error) {
            console.error('Error submitting transaction:', error)
            alert(error.message || 'Error submitting transaction')
        } finally {
            setLoading(false)
        }
    }

    if (submitted) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center p-6">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/15">
                    <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                </div>
                <h1 className="text-center text-2xl font-bold text-white">Submitted Successfully!</h1>
                <p className="mt-2 text-center text-[var(--text-muted)]">Your deposit request is pending approval.</p>
                <p className="mt-4 text-sm text-[var(--text-dim)]">Redirecting...</p>
            </div>
        )
    }

    return (
        <div className="min-h-screen p-4 pb-28">
            <div className="glass mb-6 rounded-2xl p-6 text-center">
                <p className="text-sm font-medium text-[var(--text-muted)]">Payment Amount</p>
                <h1 className="mt-2 text-3xl font-black text-gradient">₹ {amount}</h1>
            </div>

            <h2 className="mb-4 ml-2 text-sm font-bold uppercase tracking-wide text-[var(--text-muted)]">Select Payment Method</h2>

            <div className="space-y-4">
                {/* Generic UPI QR */}
                <div className="glass overflow-hidden rounded-2xl">
                    <button
                        onClick={() => setOpenAccordion(openAccordion === 'upi' ? '' : 'upi')}
                        className="flex w-full items-center justify-between p-4"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1">
                                <img src="/upi/upi.svg" alt="UPI" className="h-full w-full object-contain" />
                            </div>
                            <span className="font-bold text-white">Any UPI App (Scan QR)</span>
                        </div>
                        {openAccordion === 'upi' ? <ChevronDown className="h-5 w-5 text-[var(--text-muted)]" /> : <ChevronRight className="h-5 w-5 text-[var(--text-muted)]" />}
                    </button>

                    {openAccordion === 'upi' && (
                        <div className="flex flex-col items-center border-t border-white/10 bg-black/20 p-6">
                            <div className="mb-4 rounded-xl bg-white p-4 shadow-sm">
                                <QRCodeSVG value={`upi://pay?pa=${adminUpi}&pn=${ADMIN_NAME}&am=${amount}&cu=INR`} size={180} />
                            </div>
                            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2">
                                <span className="text-sm font-medium text-white/90">{adminUpi}</span>
                                <button onClick={() => copyToClipboard(adminUpi)}>
                                    <Copy className="h-4 w-4 text-navy-300" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Specific Apps Deep Links */}
                {[
                    { id: 'phonepe', name: 'PhonePe', logo: '/upi/phonepe.svg' },
                    { id: 'gpay', name: 'Google Pay', logo: '/upi/gpay.svg' },
                    { id: 'paytm', name: 'Paytm', logo: '/upi/paytm.svg' },
                    { id: 'bhim', name: 'BHIM', logo: '/upi/bhim.svg' },
                ].map((app) => (
                    <div key={app.id} className="glass rounded-2xl">
                        <a
                            href={generateDeepLink(app.id)}
                            onClick={() => setOpenAccordion(app.id)}
                            className="flex w-full items-center justify-between p-4"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1">
                                    <img src={app.logo} alt={app.name} className="h-full w-full object-contain" />
                                </div>
                                <span className="font-bold text-white">{app.name}</span>
                            </div>
                            <span className="rounded-full bg-navy-500/15 px-3 py-1 text-xs font-bold text-navy-300">PAY</span>
                        </a>
                    </div>
                ))}
            </div>

            {/* Payer UPI */}
            <div className="mt-8">
                <label className="mb-2 ml-1 block text-sm font-bold text-white/90">Your UPI ID (the one you paid from)</label>
                <div className="glass flex gap-2 rounded-xl p-2">
                    <input
                        type="text"
                        value={payerUpi}
                        onChange={(e) => setPayerUpi(e.target.value.toLowerCase().trim())}
                        disabled={!!registeredUpi}
                        placeholder="e.g. 9876543210@paytm"
                        className="flex-1 bg-transparent px-4 py-2 font-medium text-white outline-none disabled:text-white/60"
                    />
                    {registeredUpi && <Lock className="mr-3 h-4 w-4 shrink-0 self-center text-navy-300" />}
                </div>
                <p className="ml-1 mt-2 text-xs text-[var(--text-dim)]">
                    {registeredUpi
                        ? 'This UPI ID is locked to your account. Pay from this ID only — withdrawals are credited back to it.'
                        : 'Deposits are accepted only from this UPI ID and withdrawals are paid back to it. It cannot be changed later.'}
                </p>
            </div>

            {/* UTR Submission */}
            <div className="mt-6">
                <label className="mb-2 ml-1 block text-sm font-bold text-white/90">Submit Reference No / UTR</label>
                <div className="glass flex gap-2 rounded-xl p-2">
                    <input
                        type="text"
                        value={utr}
                        onChange={(e) => setUtr(e.target.value)}
                        placeholder="Enter 12-digit UTR number"
                        className="flex-1 bg-transparent px-4 py-2 font-medium text-white outline-none"
                    />
                </div>
                <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="btn-navy mt-6 w-full rounded-xl py-4 font-bold"
                >
                    {loading ? 'Submitting...' : 'Submit Payment'}
                </button>
            </div>
        </div>
    )
}

export default function PaymentPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-[var(--text-muted)]">Loading...</div>}>
            <PaymentProcess />
        </Suspense>
    )
}
