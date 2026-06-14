'use client'

import { createClient } from '@/utils/supabase/client'
import { useEffect, useState } from 'react'
import { Plus, Headset, Info, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function ToolPage() {
    const [tools, setTools] = useState([])
    const [loading, setLoading] = useState(true)
    const supabase = createClient()
    const router = useRouter()

    const [showAddModal, setShowAddModal] = useState(false)
    const [newUpiId, setNewUpiId] = useState('')
    const [upiName, setUpiName] = useState('')
    const [upiError, setUpiError] = useState('')
    const [warning, setWarning] = useState('')
    const [showLimitModal, setShowLimitModal] = useState(false)

    useEffect(() => {
        fetchTools()
    }, [])

    const fetchTools = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data, error } = await supabase
            .from('user_tools')
            .select('*')
            .order('created_at', { ascending: false })

        if (data) setTools(data)
        setLoading(false)
    }

    const handleAddClick = async () => {
        // limit check
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data: count, error } = await supabase.rpc('get_daily_tool_count', { target_user_id: user.id })

            if (error) {
                console.error(error)
                return
            }

            if (count >= 5) {
                setShowLimitModal(true)
                return
            }

            setShowAddModal(true)
            setNewUpiId('')
            setUpiName('')
            setUpiError('')
        } catch (e) {
            console.error(e)
        }
    }

    const validateUpiFormat = (upi) => {
        // UPI regex: username@provider
        const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z]+$/

        if (!upi) {
            return 'UPI ID is required'
        }

        if (!upiRegex.test(upi)) {
            return 'Invalid UPI format. Example: 9876543210@paytm'
        }

        const [username, provider] = upi.split('@')

        if (username.length < 3) {
            return 'UPI username too short'
        }

        const validProviders = ['paytm', 'ybl', 'okaxis', 'okicici', 'okhdfcbank', 'oksbi', 'axl', 'ibl', 'airtel', 'fbl', 'pockets', 'upi']

        if (!validProviders.includes(provider.toLowerCase())) {
            return `Unknown UPI provider: @${provider}. Common providers: @paytm, @ybl, @okaxis, @okicici`
        }

        return null // Valid
    }

    const handleUpiChange = (e) => {
        const value = e.target.value.toLowerCase().trim()
        setNewUpiId(value)
        // setUpiName('') // Don't reset name manually entered

        if (value) {
            const error = validateUpiFormat(value)
            setUpiError(error || '')
        } else {
            setUpiError('')
        }
    }

    // handleVerifyUpi removed

    const handleAddSubmit = async (e) => {
        e.preventDefault()

        if (!upiName.trim()) {
            setUpiError('Please verify UPI first to get account name')
            return
        }

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        try {
            // Check for duplicate UPI globally using RPC
            const { data: exists, error: checkError } = await supabase.rpc('check_upi_exists', {
                upi_id_input: newUpiId
            })

            if (checkError) throw checkError

            if (exists) {
                setUpiError('This UPI ID is already registered in the system')
                return
            }

            const { error } = await supabase.from('user_tools').insert({
                user_id: user.id,
                upi_id: newUpiId,
                name: upiName, // Insert Name
                status: 'pending_verification', // New Default Status
                platform: newUpiId.split('@')[1] || 'upi'
            })

            if (error) throw error
            setShowAddModal(false)
            fetchTools() // Refresh list
        } catch (e) {
            console.error(e)
            setUpiError(e.message || "Failed to add tool")
        }
    }

    // Gradient helper based on platform/index
    const getGradient = (index) => {
        if (index % 2 === 0) return 'bg-gradient-to-br from-navy-600 to-navy-900' // Navy
        return 'bg-gradient-to-br from-[#1b2540] to-[#0a0e16]' // Deep slate
    }

    const toggleToolStatus = async (id, currentStatus) => {
        // If trying to start a tool, check if another is already running
        if (currentStatus !== 'running') {
            const activeTool = tools.find(t => t.status === 'running')
            if (activeTool) {
                setWarning('Only one tool can run at a time. Please stop the currently running tool first.')
                setTimeout(() => setWarning(''), 3000)
                return
            }
        }

        const newStatus = currentStatus === 'running' ? 'stopped' : 'running'

        // Optimistic update
        setTools(tools.map(t => t.id === id ? { ...t, status: newStatus } : t))

        const { error } = await supabase
            .from('user_tools')
            .update({ status: newStatus })
            .eq('id', id)

        if (error) {
            console.error('Error updating status:', error)
            // Revert on error
            setTools(tools.map(t => t.id === id ? { ...t, status: currentStatus } : t))
            alert('Failed to update status')
        }
    }

    if (loading) return <div className="flex min-h-screen items-center justify-center text-[var(--text-muted)]">Loading...</div>

    return (
        <div className="relative min-h-screen pb-28">
            {/* Header */}
            <div className="glass sticky top-0 z-10 flex items-center justify-between px-5 py-4">
                <h1 className="text-xl font-bold text-white">Tools</h1>
                <button className="text-navy-300 transition-colors hover:text-white">
                    <Headset className="h-6 w-6" />
                </button>
            </div>

            {/* Warning Toast */}
            {warning && (
                <div className="anim-slide-up fixed left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500/90 px-6 py-3 text-sm font-bold text-white shadow-lg backdrop-blur-sm">
                    <Info className="h-5 w-5" />
                    {warning}
                </div>
            )}

            <div className="px-4 pt-4">
                <div className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                    <div>
                        <h2 className="text-sm font-bold text-amber-300">Account Safety Warning</h2>
                        <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                            Do not use the same UPI ID twice. Linked accounts must be unique.
                            <br />
                            <span className="font-semibold">Re-using a UPI ID will result in an immediate permanent ban.</span>
                            <br />
                            <span className="mt-1 block font-bold text-amber-200">Limit: You can only add 5 UPI IDs per day. Exceeding this limit leads to a permanent ban.</span>
                        </p>
                    </div>
                </div>
            </div>


            {/* List */}
            <div className="space-y-4 p-4">
                {tools.map((tool, index) => (
                    <div key={tool.id} className={`relative overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-lg ${getGradient(index)}`}>
                        <div className="flex items-start justify-between">
                            <div className="flex gap-4">
                                {/* Logo Placeholder */}
                                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20 bg-white/10 backdrop-blur-sm">
                                    <span className="text-lg font-bold uppercase">{tool.upi_id[0]}</span>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold">{tool.upi_id}</h3>
                                    <p className="text-sm text-white/60">{tool.phone_number || tool.upi_id.split('@')[0]}</p>
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                                <div className={`rounded-full border px-4 py-1 text-xs font-bold ${tool.status === 'running' ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300' :
                                    tool.status === 'pending_verification' ? 'border-amber-400/50 bg-amber-500/15 text-amber-300' :
                                        tool.status === 'rejected' ? 'border-red-500/50 bg-red-500/15 text-red-300' :
                                            'border-red-400/50 bg-red-500/10 text-red-300'
                                    }`}>
                                    {tool.status === 'running' ? 'RUNNING' :
                                        tool.status === 'pending_verification' ? 'PENDING' :
                                            tool.status === 'rejected' ? 'REJECTED' : 'STOPPED'}
                                </div>
                                {tool.status === 'running' ? (
                                    <button
                                        onClick={() => toggleToolStatus(tool.id, 'running')}
                                        className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-red-700"
                                    >
                                        ⏹ STOP
                                    </button>
                                ) : tool.status === 'stopped' ? (
                                    <button
                                        onClick={() => toggleToolStatus(tool.id, 'stopped')}
                                        className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-amber-600"
                                    >
                                        Operate
                                    </button>
                                ) : (
                                    <button disabled className="cursor-not-allowed rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold text-white/40">
                                        Wait...
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Info Strip */}
                        {index % 2 !== 0 && (
                            <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2 text-[10px] text-white/80 backdrop-blur-md">
                                <Info className="h-4 w-4 text-white/60" />
                                Please relink the tool or modify the upi and relink.
                            </div>
                        )}

                        {/* Background Decoration */}
                        <div className="pointer-events-none absolute -bottom-2 -right-2 text-4xl font-black uppercase italic text-white/5">
                            {tool.platform}
                        </div>
                    </div>
                ))}

                {tools.length === 0 && (
                    <div className="mt-20 text-center text-[var(--text-dim)]">
                        <p>No tools active.</p>
                        <p className="text-sm">Click + to add.</p>
                    </div>
                )}
            </div>

            {/* FAB */}
            <button
                onClick={handleAddClick}
                className="btn-navy fixed bottom-28 right-6 z-20 flex h-14 w-14 items-center justify-center rounded-2xl"
            >
                <Plus className="h-8 w-8" />
            </button>

            {/* Add Tool Modal */}
            {showAddModal && (
                <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="anim-pop glass-strong w-full max-w-sm rounded-3xl p-6 shadow-2xl">
                        <h2 className="mb-4 text-xl font-bold text-white">Add New Tool</h2>
                        <form onSubmit={handleAddSubmit}>
                            <div className="mb-4">
                                <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">UPI ID</label>
                                <input
                                    type="text"
                                    placeholder="e.g. 9876543210@paytm"
                                    value={newUpiId}
                                    onChange={handleUpiChange}
                                    className={`w-full rounded-xl border bg-white/5 px-4 py-3 font-medium text-white focus:outline-none focus:ring-2 focus:ring-navy-500/30 ${upiError && newUpiId ? 'border-red-500' : 'border-white/10 focus:border-navy-400'}`}
                                    autoFocus
                                />
                                {upiError && newUpiId && (
                                    <p className="mt-1 text-xs text-red-400">{upiError}</p>
                                )}
                            </div>

                            <div className="mb-6">
                                <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">Account Name</label>
                                <input
                                    type="text"
                                    placeholder="Enter verified name on UPI"
                                    value={upiName}
                                    onChange={(e) => setUpiName(e.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-medium text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                                />
                                <p className="mt-1 text-xs text-[var(--text-dim)]">This name will be verified by admin.</p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 font-bold text-[var(--text-muted)] transition-colors hover:bg-white/10"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!!upiError || !newUpiId || !upiName.trim()}
                                    className="btn-navy flex-1 rounded-xl py-3 font-bold disabled:cursor-not-allowed"
                                >
                                    Add Tool
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Daily Limit Modal */}
            {showLimitModal && (
                <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="anim-pop glass-strong w-full max-w-sm rounded-3xl border border-red-500/30 p-6 shadow-2xl">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/15">
                            <AlertTriangle className="h-6 w-6 text-red-400" />
                        </div>
                        <h2 className="mb-2 text-center text-xl font-bold text-white">Daily Limit Reached</h2>
                        <p className="mb-6 text-center text-sm leading-relaxed text-[var(--text-muted)]">
                            You have reached the limit of <span className="font-bold text-white">5 UPI IDs</span> per day.
                            Try again tomorrow.
                            <br /><br />
                            <span className="rounded bg-red-500/15 px-2 py-1 font-bold text-red-400">
                                Warning: Trying to bypass this rule will result in a permanent ban.
                            </span>
                        </p>
                        <button
                            onClick={() => setShowLimitModal(false)}
                            className="btn-navy w-full rounded-xl py-3 font-bold"
                        >
                            Understood
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
