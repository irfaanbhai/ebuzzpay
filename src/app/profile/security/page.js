'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, Lock, Key } from 'lucide-react'

export default function SecurityPage() {
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    const handlePasswordChange = async (e) => {
        e.preventDefault()
        setLoading(true)
        const { error } = await supabase.auth.updateUser({ password })

        if (error) {
            alert('Error updating password: ' + error.message)
        } else {
            alert('Password updated successfully!')
            setPassword('')
        }
        setLoading(false)
    }

    return (
        <div className="min-h-screen">
            {/* Header */}
            <div className="glass sticky top-0 z-10 flex items-center gap-4 px-5 py-4">
                <button onClick={() => router.back()} className="text-[var(--text-muted)] transition-colors hover:text-white">
                    <ArrowLeft className="h-6 w-6" />
                </button>
                <h1 className="text-xl font-bold text-white">Security Settings</h1>
            </div>

            <div className="space-y-6 p-4">
                {/* Change Password */}
                <div className="glass rounded-2xl p-6">
                    <div className="mb-4 flex items-center gap-3 text-navy-300">
                        <Lock className="h-5 w-5" />
                        <h2 className="font-bold text-white">Change Password</h2>
                    </div>
                    <form onSubmit={handlePasswordChange}>
                        <input
                            type="password"
                            placeholder="New Password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                            minLength={6}
                            required
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-navy w-full rounded-xl py-3 font-bold"
                        >
                            {loading ? 'Updating...' : 'Update Password'}
                        </button>
                    </form>
                </div>

                {/* Payment Pin */}
                <div className="glass rounded-2xl p-6 opacity-70">
                    <div className="mb-4 flex items-center gap-3 text-[var(--text-muted)]">
                        <Key className="h-5 w-5" />
                        <h2 className="font-bold text-white">Payment Pin</h2>
                    </div>
                    <p className="mb-4 text-sm text-[var(--text-muted)]">Set a 4-digit pin for withdrawals.</p>
                    <button
                        onClick={() => alert('Pin feature coming in next update')}
                        className="w-full rounded-xl border border-white/10 bg-white/5 py-3 font-bold text-[var(--text-muted)]"
                    >
                        Set Pin (Coming Soon)
                    </button>
                </div>
            </div>
        </div>
    )
}
