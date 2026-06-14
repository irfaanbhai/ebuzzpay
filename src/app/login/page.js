'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { login, signup } from './actions'
import { Download, Smartphone } from 'lucide-react'

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [installPrompt, setInstallPrompt] = useState(null)
    const [isStandalone, setIsStandalone] = useState(false)
    const router = useRouter()

    useEffect(() => {
        // Check if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsStandalone(true)
        }

        const handler = (e) => {
            e.preventDefault()
            setInstallPrompt(e)
        }
        window.addEventListener('beforeinstallprompt', handler)
        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [])

    // Auto-switch to Signup if on /register
    useEffect(() => {
        if (window.location.pathname === '/register') {
            setIsLogin(false)
        }
    }, [])

    // Get ref code
    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const referralCode = searchParams?.get('ref')


    const handleInstallClick = async () => {
        if (installPrompt) {
            installPrompt.prompt()
            const { outcome } = await installPrompt.userChoice
            if (outcome === 'accepted') {
                setInstallPrompt(null)
            }
        } else {
            // Fallback for iOS or if prompt not ready
            alert("To install this app:\n\n1. Tap the browser menu (three dots) or Share button\n2. Select 'Add to Home Screen' or 'Install App'")
        }
    }

    const handleGoogleLogin = async () => {
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        })
        if (error) setError(error.message)
    }

    const handleSubmit = async (event) => {
        event.preventDefault()
        setLoading(true)
        setError(null)

        const formData = new FormData(event.currentTarget)

        try {
            const action = isLogin ? login : signup
            const result = await action(formData)
            if (result?.error) {
                console.error('Action reported error:', result.error)
                setError(result.error)
            } else if (result?.success) {
                router.push('/')
                router.refresh()
            }
        } catch (e) {
            console.error('Unexpected error in handleSubmit:', e)
            setError('An unexpected error occurred: ' + e.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="relative flex min-h-screen flex-col items-center justify-center px-6 py-12">
            {/* ambient glow */}
            <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-navy-600/20 blur-3xl" />

            {!isStandalone && (
                <button
                    onClick={handleInstallClick}
                    className="btn-navy absolute right-4 top-4 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold"
                >
                    <Download className="h-4 w-4" />
                    Download App
                </button>
            )}

            <div className="relative z-10 w-full max-w-md">
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-black tracking-tight text-gradient">EbuzzPay</h1>
                    <h2 className="mt-3 text-xl font-bold text-white">
                        {isLogin ? 'Welcome back' : 'Create your account'}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {isLogin ? 'Sign in to continue to your wallet' : 'Join EbuzzPay in a few seconds'}
                    </p>
                </div>

                <div className="glass-strong rounded-3xl px-6 py-8 shadow-2xl sm:px-8">
                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--text-muted)]">
                                Email address
                            </label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-[var(--text-dim)] transition-all focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--text-muted)]">
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-[var(--text-dim)] transition-all focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                            />
                        </div>

                        {error && (
                            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">{error}</div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-navy flex w-full justify-center rounded-xl py-3 text-sm font-bold"
                        >
                            {loading ? 'Processing...' : isLogin ? 'Sign in' : 'Sign up'}
                        </button>
                        {!isLogin && referralCode && (
                            <input type="hidden" name="referrer_code" value={referralCode} />
                        )}
                    </form>

                    <div className="mt-6">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-white/10" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="bg-transparent px-2 text-[var(--text-dim)]">
                                    Or continue with
                                </span>
                            </div>
                        </div>

                        <div className="mt-6">
                            <button
                                onClick={handleGoogleLogin}
                                className="inline-flex w-full justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
                            >
                                <svg
                                    className="h-5 w-5"
                                    aria-hidden="true"
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.813.92 6.507 2.49l2.453-2.453C19.12 1.347 16.107 0 12.48 0 5.867 0 0 5.867 0 12.48c0 6.613 5.867 12.48 12.48 12.48 3.52 0 6.013-1.173 8.013-3.267 2.053-2.12 2.627-5.32 2.507-7.827H12.48z"
                                    />
                                </svg>
                                <span className="ml-2">Google</span>
                            </button>
                        </div>
                    </div>

                    <div className="mt-6 text-center">
                        <button
                            onClick={() => setIsLogin(!isLogin)}
                            className="text-sm font-medium text-navy-300 transition-colors hover:text-navy-400"
                        >
                            {isLogin
                                ? "Don't have an account? Sign up"
                                : 'Already have an account? Sign in'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
