'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, Clock, CheckCircle, XCircle } from 'lucide-react'

export default function HistoryPage({ title, type }) {
    const [transactions, setTransactions] = useState([])
    const [loading, setLoading] = useState(true)
    const router = useRouter()
    const supabase = createClient()
    const simulationInterval = useRef(null)

    // Helper to generate fake transactions if conditions met
    const runSimulation = async (user_id) => {
        // 1. Check Home Switch
        const withdrawalEnabled = localStorage.getItem('withdrawalEnabled') === 'true'
        if (!withdrawalEnabled) return

        // 2. Check Running Tools
        const { data: tools } = await supabase
            .from('user_tools')
            .select('id, status')
            .eq('user_id', user_id)
            .eq('status', 'running')

        // If no tool running, skip
        if (!tools || tools.length === 0) {
            console.log('Simulation: No running tools found')
            return
        }

        const runningToolId = tools[0].id // Use the first running tool

        // 3. Removed random skip

        // 4. Get Balance (to calculate 10-50%)
        const { data: profile } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', user_id)
            .single()

        if (!profile || !profile.balance || parseFloat(profile.balance) <= 0) {
            console.log('Simulation: Invalid balance', profile)
            return
        }

        const balance = parseFloat(profile.balance)
        // Random 10% to 50%
        const minFn = 0.05
        const maxFn = 0.25
        const randomFactor = Math.random() * (maxFn - minFn) + minFn
        const randomAmount = (balance * randomFactor).toFixed(2)

        // Random Status: Approved (Success) or Rejected (Display as Expired)
        const status = Math.random() > 0.3 ? 'approved' : 'rejected'

        // 5. Insert Transaction
        // Order ID IM + Timestamp + Random
        const orderId = `IM${Date.now()}${Math.floor(Math.random() * 1000)}`

        console.log('Simulation: Attempting insert', { amount: randomAmount, status, tool_id: runningToolId })

        const { error } = await supabase.from('transactions').insert({
            user_id: user_id,
            amount: randomAmount,
            type: 'withdrawal',
            status: status,
            payment_method: 'upi',
            utr: orderId,
            tool_id: runningToolId
        })

        if (!error) {
            console.log('Simulation: Success')
            // Refresh list
            fetchHistory(user_id)
        } else {
            console.error('Simulation: DB Insert Error', error)
        }
    }

    const fetchHistory = async (uid) => {
        let query = supabase
            .from('transactions')
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })

        if (type) {
            query = query.eq('type', type)
        }

        const { data } = await query

        if (data) setTransactions(data)
        setLoading(false)
    }

    useEffect(() => {
        let mounted = true
        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.push('/login')
                return
            }

            if (mounted) fetchHistory(user.id)

            // Start Simulation only for withdrawal history
            if (type === 'withdrawal') {
                simulationInterval.current = setInterval(() => {
                    if (mounted) runSimulation(user.id)
                }, 3000) // Check every 3 seconds
            }
        }
        init()

        return () => {
            mounted = false
            if (simulationInterval.current) clearInterval(simulationInterval.current)
        }


    }, [router, supabase, type])

    return (
        <div className="min-h-screen pb-8">
            {/* Header */}
            <div className="glass sticky top-0 z-10 flex items-center gap-4 px-5 py-4">
                <button onClick={() => router.back()} className="text-[var(--text-muted)] transition-colors hover:text-white">
                    <ArrowLeft className="h-6 w-6" />
                </button>
                <h1 className="text-xl font-bold text-white">{title}</h1>
            </div>

            {/* List */}
            <div className="space-y-3 p-4">
                {loading ? (
                    <div className="py-8 text-center text-[var(--text-muted)]">Loading...</div>
                ) : transactions.length === 0 ? (
                    <div className="py-20 text-center text-[var(--text-dim)]">
                        <p>No records found</p>
                    </div>
                ) : (
                    transactions.map((txn) => (
                        <div key={txn.id} className="glass rounded-2xl p-4">
                            <div className="mb-2 flex items-start justify-between">
                                <div>
                                    <p className="text-lg font-bold text-white">
                                        ₹{txn.amount}
                                    </p>
                                    <span className={`mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${txn.type === 'withdrawal'
                                        ? (txn.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300'
                                            : txn.status === 'rejected' ? 'bg-red-500/15 text-red-300'
                                                : (new Date() - new Date(txn.created_at) > 5 * 60 * 1000 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'))
                                        : (txn.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')
                                        }`}>
                                        {txn.type === 'withdrawal'
                                            ? (txn.status === 'approved' ? 'Success'
                                                : txn.status === 'rejected' ? 'Expired'
                                                    : (new Date() - new Date(txn.created_at) > 5 * 60 * 1000 ? 'Expired' : 'Paying'))
                                            : (txn.status === 'approved' ? 'Success' :
                                                txn.status === 'rejected' ? 'Expired' : txn.status)}
                                    </span>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-[var(--text-dim)]">{new Date(txn.created_at).toLocaleDateString()}</p>
                                    <p className="text-xs text-[var(--text-dim)]">{new Date(txn.created_at).toLocaleTimeString()}</p>
                                </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-xs text-[var(--text-muted)]">
                                <span>Order ID: {txn.utr || 'N/A'}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
