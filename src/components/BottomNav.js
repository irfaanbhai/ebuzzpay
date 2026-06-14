'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Wallet, Wrench, Users, Briefcase } from 'lucide-react'

export default function BottomNav() {
    const pathname = usePathname()

    // Hide bottom nav on login page, admin page, or if pathname is null
    if (!pathname || pathname.startsWith('/login') || pathname.startsWith('/admin')) {
        return null
    }

    const navItems = [
        { name: 'Home', href: '/', icon: Home },
        { name: 'Deposit', href: '/deposit', icon: Wallet },
        { name: 'Tool', href: '/tool', icon: Wrench },
        { name: 'Teams', href: '/teams', icon: Users },
        { name: 'Assets', href: '/assets', icon: Briefcase },
    ]

    return (
        <div className="fixed bottom-0 left-0 z-50 w-full pointer-events-none">
            <div className="mx-auto max-w-5xl px-4 pb-4 pt-2">
                <div className="glass-strong pointer-events-auto flex h-16 w-full items-center rounded-2xl px-2 shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.8)]">
                    {navItems.map((item) => {
                        const Icon = item.icon
                        const isActive = pathname === item.href
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className="group relative inline-flex flex-1 flex-col items-center justify-center gap-1 px-1 py-1"
                            >
                                <span
                                    className={`flex h-9 w-12 items-center justify-center rounded-xl transition-all duration-200 ${isActive
                                        ? 'bg-gradient-to-br from-navy-500 to-navy-700 text-white shadow-[0_6px_18px_-6px_rgba(51,94,201,0.8)]'
                                        : 'text-[var(--text-dim)] group-hover:text-[var(--text-muted)]'
                                        }`}
                                >
                                    <Icon className="h-5 w-5" />
                                </span>
                                <span
                                    className={`text-[10px] font-medium tracking-wide transition-colors ${isActive ? 'text-white' : 'text-[var(--text-dim)] group-hover:text-[var(--text-muted)]'
                                        }`}
                                >
                                    {item.name}
                                </span>
                            </Link>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
