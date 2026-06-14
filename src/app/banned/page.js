'use client'

import { XCircle } from 'lucide-react'

export default function BannedPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
            <div className="glass-strong w-full max-w-md rounded-3xl p-8 shadow-2xl">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-red-500/30 bg-red-500/15">
                    <XCircle className="h-8 w-8 text-red-400" />
                </div>

                <h1 className="mb-3 text-2xl font-bold text-white">Account Suspended</h1>

                <p className="mb-6 text-sm text-[var(--text-muted)]">
                    Your account has been suspended due to violation of our terms of service.
                </p>

                <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-[var(--text-dim)]">
                    Contact support if you believe this is an error.
                </div>
            </div>
        </div>
    )
}
