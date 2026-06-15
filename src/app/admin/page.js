'use client'

import { createClient } from '@/utils/supabase/client'
import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock, LayoutDashboard, Users, Receipt, Smartphone, Play, Square } from 'lucide-react'

export default function AdminPage() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [password, setPassword] = useState('')
    const [activeTab, setActiveTab] = useState('dashboard') // Default to dashboard

    // Data States
    const [transactions, setTransactions] = useState([])
    const [users, setUsers] = useState([])
    const [tools, setTools] = useState([])
    const [stats, setStats] = useState({ total_users: 0, total_balance: 0, pending_deposits: 0, pending_withdrawals: 0 })
    const [adminUpi, setAdminUpi] = useState('')
    const [usdtRate, setUsdtRate] = useState('')
    const [telegramLink, setTelegramLink] = useState('')
    const [userSearch, setUserSearch] = useState('')
    const [page, setPage] = useState(0)
    const [hasMore, setHasMore] = useState(true)

    // Transactions Search (No Pagination)
    const [txnSearch, setTxnSearch] = useState('')

    // Tools Search & Pagination
    const [toolsSearch, setToolsSearch] = useState('')
    const [toolsPage, setToolsPage] = useState(0)
    const [toolsHasMore, setToolsHasMore] = useState(true)

    const ITEMS_PER_PAGE = 50

    // Maintenance Settings
    const [maintenanceMode, setMaintenanceMode] = useState(false)
    const [maintenanceHeading, setMaintenanceHeading] = useState('')
    const [maintenanceDesc, setMaintenanceDesc] = useState('')

    // Withdrawal Tab States
    const [withdrawalTools, setWithdrawalTools] = useState([])
    const [selectedTool, setSelectedTool] = useState(null)
    const [selectedToolHistory, setSelectedToolHistory] = useState([])
    const [isModalOpen, setIsModalOpen] = useState(false)

    const [loading, setLoading] = useState(true)
    const supabase = createClient()

    useEffect(() => {
        // Check localStorage for saved password
        const savedPassword = localStorage.getItem('adminPassword')
        if (savedPassword === 'admin@1212') {
            setIsAuthenticated(true)
        }
    }, [])

    useEffect(() => {
        if (isAuthenticated) {
            // Initial fetch or when tab changes
            fetchData()

            // Auto-refresh for Withdrawal tab
            let interval
            if (activeTab === 'withdrawal') {
                interval = setInterval(fetchWithdrawalTools, 1000)
            }
            return () => clearInterval(interval)
        }
    }, [isAuthenticated, activeTab])

    // Debounced search for Users
    useEffect(() => {
        if (isAuthenticated && activeTab === 'users') {
            const delay = setTimeout(fetchUsers, 500)
            return () => clearTimeout(delay)
        }
    }, [userSearch, page])

    // Debounced search for Transactions
    useEffect(() => {
        if (isAuthenticated && activeTab === 'transactions') {
            const delay = setTimeout(fetchTransactions, 500)
            return () => clearTimeout(delay)
        }
    }, [txnSearch])

    // Debounced search for Tools
    useEffect(() => {
        if (isAuthenticated && activeTab === 'tools') {
            const delay = setTimeout(fetchTools, 500)
            return () => clearTimeout(delay)
        }
    }, [toolsSearch, toolsPage])

    const handleLogin = (e) => {
        e.preventDefault()
        if (password === 'admin@1212') {
            setIsAuthenticated(true)
            localStorage.setItem('adminPassword', password)
        } else {
            alert('Invalid Password')
        }
    }

    const handleLogout = () => {
        setIsAuthenticated(false)
        localStorage.removeItem('adminPassword')
    }

    const fetchData = async () => {
        setLoading(true)
        if (activeTab === 'dashboard') await fetchStats()
        if (activeTab === 'transactions') await fetchTransactions()
        if (activeTab === 'users') await fetchUsers()
        if (activeTab === 'tools') await fetchTools()
        if (activeTab === 'withdrawal') await fetchWithdrawalTools()
        if (activeTab === 'settings') await fetchSettings()
        setLoading(false)
    }

    const fetchStats = async () => {
        const { data, error } = await supabase.rpc('get_admin_dashboard_stats')
        if (data) setStats(data)
        else console.error(error)
    }

    const fetchTransactions = async () => {
        const { data, error } = await supabase.rpc('get_all_transactions', {
            search_query: txnSearch || null
        })
        if (data) {
            // Keep behavior: show all returned (which is all matching records)
            setTransactions(data)
        }
        else console.error(error)
    }

    const fetchUsers = async () => {
        const { data, error } = await supabase.rpc('get_admin_users_extended', {
            search_query: userSearch || null,
            p_limit: ITEMS_PER_PAGE,
            p_offset: page * ITEMS_PER_PAGE
        })
        if (data) {
            setUsers(data)
            setHasMore(data.length === ITEMS_PER_PAGE)
        }
        else console.error(error)
    }

    const fetchTools = async () => {
        const { data, error } = await supabase.rpc('get_all_tools', {
            search_query: toolsSearch || null,
            p_limit: ITEMS_PER_PAGE,
            p_offset: toolsPage * ITEMS_PER_PAGE
        })
        if (data) {
            setTools(data)
            setToolsHasMore(data.length === ITEMS_PER_PAGE)
        }
        else console.error(error)
    }

    const fetchWithdrawalTools = async () => {
        const { data, error } = await supabase.rpc('get_tools_activity_stats')
        if (data) setWithdrawalTools(data)
        else console.error(error)
    }

    const fetchSettings = async () => {
        const { data: upi } = await supabase.rpc('get_admin_setting', { setting_key: 'admin_upi' })
        if (upi) setAdminUpi(upi)

        const { data: rate } = await supabase.rpc('get_admin_setting', { setting_key: 'usdt_rate' })
        if (rate) setUsdtRate(rate)

        const { data: tg } = await supabase.rpc('get_admin_setting', { setting_key: 'telegram_link' })
        if (tg) setTelegramLink(tg)

        const { data: mm } = await supabase.rpc('get_admin_setting', { setting_key: 'maintenance_mode' })
        if (mm) setMaintenanceMode(mm === 'true')

        const { data: mh } = await supabase.rpc('get_admin_setting', { setting_key: 'maintenance_heading' })
        if (mh) setMaintenanceHeading(mh)

        const { data: md } = await supabase.rpc('get_admin_setting', { setting_key: 'maintenance_description' })
        if (md) setMaintenanceDesc(md)
    }

    // Actions
    const handleUpdateUpi = async (e) => {
        e.preventDefault()
        try {
            const { error } = await supabase.rpc('update_admin_setting', { setting_key: 'admin_upi', new_value: adminUpi })
            if (error) throw error
            alert('UPI ID Updated Successfully')
        } catch (error) {
            console.error(error)
            alert('Error updating UPI ID')
        }
    }

    const handleUpdateTelegramLink = async (e) => {
        e.preventDefault()
        try {
            const { error } = await supabase.rpc('update_admin_setting', { setting_key: 'telegram_link', new_value: telegramLink })
            if (error) throw error
            alert('Telegram Link Updated Successfully')
        } catch (error) {
            console.error(error)
            alert('Error updating Telegram link')
        }
    }

    const handleUpdateUsdtRate = async (e) => {
        e.preventDefault()
        if (!usdtRate || isNaN(parseFloat(usdtRate)) || parseFloat(usdtRate) <= 0) {
            return alert('Please enter a valid USDT rate')
        }
        try {
            const { error } = await supabase.rpc('update_admin_setting', { setting_key: 'usdt_rate', new_value: usdtRate.toString() })
            if (error) throw error
            alert('USDT Rate Updated Successfully')
        } catch (error) {
            console.error(error)
            alert('Error updating USDT rate')
        }
    }

    const handleUpdateMaintenance = async (e) => {
        e.preventDefault()
        try {
            await supabase.rpc('update_admin_setting', { setting_key: 'maintenance_mode', new_value: maintenanceMode.toString() })
            await supabase.rpc('update_admin_setting', { setting_key: 'maintenance_heading', new_value: maintenanceHeading })
            await supabase.rpc('update_admin_setting', { setting_key: 'maintenance_description', new_value: maintenanceDesc })
            alert('Maintenance Settings Updated')
        } catch (error) {
            console.error(error)
            alert('Error updating maintenance settings')
        }
    }

    const handleApprove = async (txnId) => {
        if (!confirm('Are you sure you want to approve this transaction?')) return
        try {
            const { error } = await supabase.rpc('approve_transaction', { transaction_id: txnId })
            if (error) throw error
            alert('Transaction Approved!')
            fetchTransactions()
        } catch (error) {
            console.error(error)
            alert('Error approving transaction')
        }
    }

    const handleReject = async (txnId) => {
        if (!confirm('Are you sure you want to REJECT this transaction?')) return
        try {
            const { error } = await supabase.rpc('reject_transaction', { transaction_id: txnId })
            if (error) throw error
            alert('Transaction Rejected!')
            fetchTransactions()
        } catch (error) {
            console.error(error)
            alert('Error rejecting transaction')
        }
    }

    const handleEditBalance = async (userId, currentBalance) => {
        const newBalance = prompt("Enter new balance:", currentBalance)
        if (newBalance === null) return
        const balanceNum = parseFloat(newBalance)
        if (isNaN(balanceNum)) { alert("Invalid amount"); return }

        try {
            const { error } = await supabase.rpc('admin_update_balance', { user_id: userId, new_balance: balanceNum })
            if (error) throw error
            alert("Balance updated!")
            fetchUsers()
        } catch (e) {
            console.error(e)
            alert("Failed to update balance")
        }
    }

    const handleVerifyTool = async (toolId) => {
        if (!confirm('Verify this tool?')) return
        try {
            const { error } = await supabase.rpc('verify_tool', { tool_id: toolId })
            if (error) throw error
            alert('Tool Verified! User can now operate it.')
            fetchTools()
        } catch (e) {
            console.error(e)
            alert('Error verifying tool')
        }
    }

    const handleRejectTool = async (toolId) => {
        if (!confirm('Reject this tool?')) return
        try {
            const { error } = await supabase.rpc('reject_tool', { tool_id: toolId })
            if (error) throw error
            alert('Tool Rejected!')
            fetchTools()
        } catch (e) {
            console.error(e)
            alert('Error rejecting tool')
        }
    }

    const handleOpenToolDetails = async (tool) => {
        setSelectedTool(tool)
        setIsModalOpen(true)
        // Fetch recent history FOR THIS TOOL specifically
        const { data, error } = await supabase.rpc('get_recent_withdrawals_for_tool', { target_tool_id: tool.id })
        if (data) setSelectedToolHistory(data)
        else {
            console.error(error)
            setSelectedToolHistory([])
        }
    }

    const handleAddEarning = async () => {
        if (!selectedTool) return
        const amount = prompt("Enter amount to add to earnings:")
        if (!amount) return
        const num = parseFloat(amount)
        if (isNaN(num) || num <= 0) {
            alert("Invalid amount")
            return
        }

        try {
            // Pass tool_id to tag the earning to this specific tool
            const { error } = await supabase.rpc('admin_add_earning', {
                target_user_id: selectedTool.user_id,
                amount: num,
                target_tool_id: selectedTool.id
            })
            if (error) throw error
            alert(`Succesfully added ₹${num} to earnings for this tool`)
            // Refresh logic if needed to show update
            // fetchWithdrawalTools()
        } catch (e) {
            console.error(e)
            alert("Failed to add earnings")
        }
    }

    if (!isAuthenticated) {
        return (
            <div className="flex min-h-screen items-center justify-center p-4">
                <form onSubmit={handleLogin} className="glass-strong w-full max-w-sm rounded-3xl p-8 shadow-2xl">
                    <h1 className="mb-6 text-center text-xl font-bold text-white">Admin Login</h1>
                    <input
                        type="password"
                        placeholder="Enter Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                    />
                    <button type="submit" className="btn-navy w-full rounded-xl py-3 font-bold">Login</button>
                </form>
            </div>
        )
    }

    const tabs = [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'transactions', label: 'Transactions', icon: Receipt },
        { id: 'users', label: 'Users', icon: Users },
        { id: 'tools', label: 'Tools', icon: Smartphone },
        { id: 'withdrawal', label: 'Withdrawal', icon: Clock },
        { id: 'settings', label: 'Settings', icon: Square },
    ]

    return (
        <div className="min-h-screen p-4 pb-20">
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gradient">Admin Panel</h1>
                <button onClick={handleLogout} className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/20">
                    Logout
                </button>
            </div>

            {/* Tab Navigation */}
            <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-2">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition-all ${activeTab === tab.id ? 'btn-navy' : 'glass text-[var(--text-muted)] hover:bg-white/10'
                            }`}
                    >
                        <tab.icon className="h-4 w-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            {loading ? (
                <div className="animate-pulse py-20 text-center text-[var(--text-dim)]">Loading data...</div>
            ) : (
                <>
                    {activeTab === 'dashboard' && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="glass rounded-2xl p-5">
                                <p className="text-xs font-bold uppercase text-[var(--text-dim)]">Total Users</p>
                                <p className="mt-1 text-2xl font-black text-white">{stats.total_users}</p>
                            </div>
                            <div className="glass rounded-2xl p-5">
                                <p className="text-xs font-bold uppercase text-[var(--text-dim)]">Total Balance</p>
                                <p className="mt-1 text-2xl font-black text-navy-300">₹{stats.total_balance}</p>
                            </div>
                            <div className="glass rounded-2xl p-5">
                                <p className="text-xs font-bold uppercase text-[var(--text-dim)]">Pending Deposits</p>
                                <p className="mt-1 text-2xl font-black text-amber-400">{stats.pending_deposits}</p>
                            </div>
                            <div className="glass rounded-2xl p-5">
                                <p className="text-xs font-bold uppercase text-[var(--text-dim)]">Pending Withdrawals</p>
                                <p className="mt-1 text-2xl font-black text-red-400">{stats.pending_withdrawals}</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'transactions' && (
                        <div className="space-y-4">
                            {/* Search Bar */}
                            <div className="glass mb-2 rounded-xl p-4">
                                <input
                                    type="text"
                                    placeholder="Search by UTR, User ID, or Email..."
                                    value={txnSearch}
                                    onChange={(e) => {
                                        setTxnSearch(e.target.value)
                                    }}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                                />
                            </div>

                            {transactions.map((txn) => (
                                <div key={txn.id} className="glass rounded-xl p-4">
                                    <div className="mb-2 flex items-start justify-between">
                                        <div>
                                            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold uppercase ${txn.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300' :
                                                txn.status === 'rejected' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'
                                                }`}>
                                                {txn.status === 'approved' ? <CheckCircle className="h-3 w-3" /> :
                                                    txn.status === 'pending' ? <Clock className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                                {txn.status}
                                            </span>
                                            <h3 className="mt-1 text-lg font-bold text-white">{txn.type === 'withdrawal' ? '-' : '+'} {txn.currency === 'USDT' ? 'USDT ' : '₹'}{txn.amount}</h3>
                                        </div>
                                        <span className="text-xs text-[var(--text-dim)]">{new Date(txn.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <div className="mb-4 rounded-lg border border-white/5 bg-white/5 p-2 text-xs text-[var(--text-muted)]">
                                        <p>User: {txn.email || txn.user_id}</p>
                                        <p>{txn.currency === 'USDT' ? 'Transaction Hash' : 'UTR'}: {txn.utr}</p>
                                        {txn.currency === 'USDT' && (
                                            <p className="mt-1 font-bold text-navy-300">Chain: {txn.chain}</p>
                                        )}
                                    </div>
                                    {txn.status === 'pending' && (
                                        <div className="flex gap-2">
                                            <button onClick={() => handleApprove(txn.id)} className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-700">Approve</button>
                                            <button onClick={() => handleReject(txn.id)} className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-sm font-bold text-red-400 hover:bg-red-500/20">Reject</button>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {transactions.length === 0 && <div className="mt-10 text-center text-[var(--text-dim)]">No transactions found</div>}
                        </div>
                    )}

                    {activeTab === 'users' && (
                        <div className="space-y-3">
                            <div className="glass mb-2 rounded-xl p-4">
                                <input
                                    type="text"
                                    placeholder="Search by Email or User ID (Enter to search)..."
                                    value={userSearch}
                                    onChange={(e) => {
                                        setUserSearch(e.target.value)
                                        setPage(0) // Reset to first page
                                    }}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                                />
                            </div>

                            {/* User List */}
                            {users.map(user => (
                                <div key={user.id} className="glass flex flex-col gap-3 rounded-xl p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="overflow-hidden">
                                            <p className="flex w-40 items-center gap-2 truncate font-medium text-white">
                                                {user.email || 'No Email'}
                                                {user.is_banned && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-400">BANNED</span>}
                                            </p>
                                            <div className="mt-2 flex gap-4">
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase text-[var(--text-dim)]">Balance</p>
                                                    <p className="font-bold text-navy-300">₹ {user.balance}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase text-[var(--text-dim)]">Today&apos;s Earn</p>
                                                    <p className="font-bold text-emerald-400">₹ {user.today_earnings || 0}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleEditBalance(user.id, user.balance)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/10">Edit</button>
                                            <button
                                                onClick={async () => {
                                                    if (!confirm(user.is_banned ? 'Unban this user?' : 'Are you sure you want to BAN this user?')) return;
                                                    try {
                                                        const { error } = await supabase.rpc('toggle_ban_user', { target_user_id: user.id, ban_status: !user.is_banned })
                                                        if (error) throw error
                                                        alert(user.is_banned ? 'User Unbanned' : 'User BANNED')
                                                        fetchUsers()
                                                    } catch (e) {
                                                        console.error(e)
                                                        alert('Error calling ban RPC')
                                                    }
                                                }}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white ${user.is_banned ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                                            >
                                                {user.is_banned ? 'Unban' : 'Ban'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Tools Section */}
                                    {user.tools && user.tools.length > 0 && (
                                        <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                                            <p className="mb-2 text-[10px] font-bold uppercase text-[var(--text-dim)]">Attached UPI IDs</p>
                                            <div className="flex flex-wrap gap-2">
                                                {user.tools.map((tool, idx) => (
                                                    <span key={idx} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${tool.status === 'running' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300' :
                                                        'border-white/10 bg-white/5 text-[var(--text-muted)]'
                                                        }`}>
                                                        <span className={`h-1.5 w-1.5 rounded-full ${tool.status === 'running' ? 'bg-emerald-400' : 'bg-[var(--text-dim)]'}`}></span>
                                                        {tool.upi_id}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {users.length === 0 && <div className="mt-10 text-center text-[var(--text-dim)]">No users found</div>}

                            {/* Pagination Controls */}
                            <div className="glass mt-4 flex items-center justify-between rounded-xl p-3">
                                <button
                                    onClick={() => setPage(p => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${page === 0 ? 'cursor-not-allowed text-[var(--text-dim)]' : 'text-navy-300 hover:bg-white/5'}`}
                                >
                                    Previous
                                </button>
                                <span className="text-sm font-medium text-[var(--text-muted)]">Page {page + 1}</span>
                                <button
                                    onClick={() => setPage(p => p + 1)}
                                    disabled={!hasMore}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${!hasMore ? 'cursor-not-allowed text-[var(--text-dim)]' : 'text-navy-300 hover:bg-white/5'}`}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'tools' && (
                        <div className="space-y-3">
                            {/* Search Bar */}
                            <div className="glass mb-2 rounded-xl p-4">
                                <input
                                    type="text"
                                    placeholder="Search by UPI ID, Name, or User ID..."
                                    value={toolsSearch}
                                    onChange={(e) => {
                                        setToolsSearch(e.target.value)
                                        setToolsPage(0)
                                    }}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                                />
                            </div>

                            {tools.map(tool => (
                                <div key={tool.id} className="glass rounded-xl p-4">
                                    <div className="mb-2 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-white">{tool.upi_id}</h3>
                                            <p className="text-xs font-medium text-[var(--text-muted)]">{tool.name || 'Unnamed'}</p>
                                        </div>
                                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${tool.status === 'running' ? 'bg-emerald-500/15 text-emerald-300' :
                                            tool.status === 'pending_verification' ? 'bg-amber-500/15 text-amber-300' :
                                                tool.status === 'rejected' ? 'bg-red-500/15 text-red-300' :
                                                    'bg-white/10 text-[var(--text-muted)]'
                                            }`}>
                                            {tool.status === 'pending_verification' ? 'PENDING' : tool.status}
                                        </span>
                                    </div>
                                    <p className="mb-2 text-xs text-[var(--text-dim)]">User: {tool.user_id}</p>

                                    {tool.status === 'pending_verification' && (
                                        <div className="mt-2 flex gap-2">
                                            <button
                                                onClick={() => handleVerifyTool(tool.id)}
                                                className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                                            >
                                                Verify
                                            </button>
                                            <button
                                                onClick={() => handleRejectTool(tool.id)}
                                                className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-xs font-bold text-red-400 hover:bg-red-500/20"
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    )}

                                    <div className="mt-2 flex gap-2 text-xs">
                                        <span className="rounded bg-white/5 px-2 py-1 text-[var(--text-muted)]">Platform: {tool.platform}</span>
                                    </div>
                                </div>
                            ))}
                            {tools.length === 0 && <div className="mt-10 text-center text-[var(--text-dim)]">No active tools found</div>}

                            {/* Pagination Controls */}
                            <div className="glass mt-4 flex items-center justify-between rounded-xl p-3">
                                <button
                                    onClick={() => setToolsPage(p => Math.max(0, p - 1))}
                                    disabled={toolsPage === 0}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${toolsPage === 0 ? 'cursor-not-allowed text-[var(--text-dim)]' : 'text-navy-300 hover:bg-white/5'}`}
                                >
                                    Previous
                                </button>
                                <span className="text-sm font-medium text-[var(--text-muted)]">Page {toolsPage + 1}</span>
                                <button
                                    onClick={() => setToolsPage(p => p + 1)}
                                    disabled={!toolsHasMore}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${!toolsHasMore ? 'cursor-not-allowed text-[var(--text-dim)]' : 'text-navy-300 hover:bg-white/5'}`}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'withdrawal' && (
                        <div className="space-y-3">
                            {withdrawalTools.map(tool => {
                                const lastWithdrawal = tool.last_withdrawal_at ? new Date(tool.last_withdrawal_at) : null
                                const lastUpdate = tool.updated_at ? new Date(tool.updated_at) : null
                                const lastActiveDate = (lastUpdate && lastWithdrawal)
                                    ? (lastUpdate > lastWithdrawal ? lastUpdate : lastWithdrawal)
                                    : (lastUpdate || lastWithdrawal)

                                const isRecent = lastWithdrawal && (new Date() - lastWithdrawal < 10 * 60 * 1000)

                                return (
                                    <button
                                        key={tool.id}
                                        onClick={() => handleOpenToolDetails(tool)}
                                        className="glass w-full rounded-xl p-4 text-left transition-colors hover:bg-white/[0.07]"
                                    >
                                        <div className="mb-1 flex items-center justify-between">
                                            <h3 className="font-bold text-white">{tool.upi_id}</h3>
                                            <div className="flex items-center gap-2">
                                                {isRecent && tool.status === 'running' && <span className="animate-pulse rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">LIVE (10m)</span>}
                                                <span className={`h-2 w-2 rounded-full ${tool.status === 'running' ? 'bg-emerald-400' : 'bg-[var(--text-dim)]'}`}></span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                                            <span>Status: <span className="font-medium uppercase">{tool.status}</span></span>
                                            <span>Last Active: {lastActiveDate ? lastActiveDate.toLocaleTimeString() : 'Never'}</span>
                                        </div>
                                    </button>
                                )
                            })}
                            {withdrawalTools.length === 0 && <div className="mt-10 text-center text-[var(--text-dim)]">No recent activity</div>}
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="space-y-4">
                            <div className="glass rounded-2xl p-6">
                                <h3 className="mb-4 text-lg font-bold text-white">Payment Settings</h3>
                                <form onSubmit={handleUpdateUpi} className="space-y-4">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">Admin UPI ID</label>
                                        <input
                                            type="text"
                                            value={adminUpi}
                                            onChange={(e) => setAdminUpi(e.target.value)}
                                            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-navy-400 focus:ring-2 focus:ring-navy-500/30"
                                            placeholder="Enter UPI ID"
                                            required
                                        />
                                        <p className="mt-1 text-xs text-[var(--text-dim)]">This UPI ID will be shown to users when depositing.</p>
                                    </div>
                                    <button
                                        type="submit"
                                        className="btn-navy rounded-lg px-6 py-2 text-sm font-bold"
                                    >
                                        Update UPI
                                    </button>
                                </form>
                            </div>

                            <div className="glass rounded-2xl p-6">
                                <h3 className="mb-4 text-lg font-bold text-white">USDT Rate</h3>
                                <form onSubmit={handleUpdateUsdtRate} className="space-y-4">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">1 USDT = ? INR</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={usdtRate}
                                            onChange={(e) => setUsdtRate(e.target.value)}
                                            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-navy-400 focus:ring-2 focus:ring-navy-500/30"
                                            placeholder="Enter USDT rate in INR"
                                            required
                                        />
                                        <p className="mt-1 text-xs text-[var(--text-dim)]">This rate is used for USDT to INR conversion across the app.</p>
                                    </div>
                                    <button
                                        type="submit"
                                        className="btn-navy rounded-lg px-6 py-2 text-sm font-bold"
                                    >
                                        Update Rate
                                    </button>
                                </form>
                            </div>

                            <div className="glass rounded-2xl p-6">
                                <h3 className="mb-4 text-lg font-bold text-white">Telegram Support Link</h3>
                                <form onSubmit={handleUpdateTelegramLink} className="space-y-4">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">Telegram URL</label>
                                        <input
                                            type="url"
                                            value={telegramLink}
                                            onChange={(e) => setTelegramLink(e.target.value)}
                                            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-navy-400 focus:ring-2 focus:ring-navy-500/30"
                                            placeholder="https://t.me/YourChannel"
                                            required
                                        />
                                        <p className="mt-1 text-xs text-[var(--text-dim)]">This link is used for the support button on the home and support pages.</p>
                                    </div>
                                    <button
                                        type="submit"
                                        className="btn-navy rounded-lg px-6 py-2 text-sm font-bold"
                                    >
                                        Update Telegram Link
                                    </button>
                                </form>
                            </div>

                            <div className="glass rounded-2xl p-6">
                                <h3 className="mb-4 text-lg font-bold text-white">Maintenance Mode</h3>
                                <form onSubmit={handleUpdateMaintenance} className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="relative inline-block h-6 w-12 cursor-pointer rounded-full transition duration-200 ease-in-out">
                                            <input
                                                type="checkbox"
                                                id="maintenance-toggle"
                                                checked={maintenanceMode}
                                                onChange={(e) => setMaintenanceMode(e.target.checked)}
                                                className="absolute z-10 h-6 w-12 cursor-pointer opacity-0"
                                            />
                                            <label
                                                htmlFor="maintenance-toggle"
                                                className={`block h-6 cursor-pointer overflow-hidden rounded-full transition-colors duration-200 ${maintenanceMode ? 'bg-red-500' : 'bg-white/20'}`}
                                            ></label>
                                            <div
                                                className={`absolute left-0 top-0 h-6 w-6 transform rounded-full bg-white shadow transition-transform duration-200 ${maintenanceMode ? 'translate-x-6' : 'translate-x-0'}`}
                                            ></div>
                                        </div>
                                        <span className={`text-sm font-bold ${maintenanceMode ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                                            {maintenanceMode ? 'MAINTENANCE ON' : 'MAINTENANCE OFF'}
                                        </span>
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">Heading</label>
                                        <input
                                            type="text"
                                            value={maintenanceHeading}
                                            onChange={(e) => setMaintenanceHeading(e.target.value)}
                                            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-navy-400 focus:ring-2 focus:ring-navy-500/30"
                                            placeholder="System Maintenance"
                                        />
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-[var(--text-muted)]">Description</label>
                                        <textarea
                                            value={maintenanceDesc}
                                            onChange={(e) => setMaintenanceDesc(e.target.value)}
                                            className="h-24 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-navy-400 focus:ring-2 focus:ring-navy-500/30"
                                            placeholder="We are performing upgrades..."
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        className="rounded-lg bg-white/10 px-6 py-2 text-sm font-bold text-white hover:bg-white/20"
                                    >
                                        Save Maintenance Settings
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Modal for Withdrawal Detail */}
            {isModalOpen && selectedTool && (
                <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="anim-pop glass-strong flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl">
                        <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-4">
                            <div>
                                <h2 className="font-bold text-white">{selectedTool.upi_id}</h2>
                                <p className="text-xs text-[var(--text-muted)]">User: {selectedTool.user_id}</p>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                                <XCircle className="h-5 w-5 text-[var(--text-muted)]" />
                            </button>
                        </div>

                        <div className="flex-1 space-y-4 overflow-y-auto p-4">
                            {/* Add Earnings Card */}
                            <div className="flex items-center justify-between rounded-xl border border-navy-400/30 bg-navy-500/10 p-4">
                                <div>
                                    <p className="text-sm font-bold text-white">Add Earnings</p>
                                    <p className="text-xs text-navy-300">Instantly credit user balance</p>
                                </div>
                                <button
                                    onClick={handleAddEarning}
                                    className="btn-navy flex h-10 w-10 items-center justify-center rounded-full"
                                >
                                    <span className="mb-1 text-2xl font-bold">+</span>
                                </button>
                            </div>

                            <h3 className="mt-4 text-sm font-bold text-white/90">Last 5 Withdrawals</h3>
                            <div className="space-y-3">
                                {selectedToolHistory.map((txn, idx) => (
                                    <div key={idx} className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-red-400">- ₹{txn.amount}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-[var(--text-dim)]">{new Date(txn.created_at).toLocaleString()}</span>
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm(`Add ₹${txn.amount} to user balance?`)) return;
                                                        try {
                                                            const { error } = await supabase.rpc('admin_add_earning', {
                                                                target_user_id: selectedTool.user_id,
                                                                amount: txn.amount,
                                                                target_tool_id: selectedTool.id
                                                            })
                                                            if (error) throw error
                                                            alert(`Added ₹${txn.amount}!`)
                                                        } catch (e) {
                                                            console.error(e)
                                                            alert("Failed")
                                                        }
                                                    }}
                                                    className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-500/20 text-navy-300 transition-colors hover:bg-navy-500/30"
                                                    title="Re-add this amount to earnings"
                                                >
                                                    <span className="text-sm font-bold">+</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="mt-1 flex items-center justify-between">
                                            {/* <span className="text-[10px] text-gray-500">Status: <span className="uppercase font-bold">{txn.status}</span></span> */}
                                            <span className="font-mono text-[10px] text-[var(--text-dim)]">{txn.utr}</span>
                                        </div>
                                    </div>
                                ))}
                                {selectedToolHistory.length === 0 && (
                                    <p className="py-4 text-center text-sm text-[var(--text-dim)]">No recent withdrawals for this tool</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
