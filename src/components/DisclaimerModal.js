'use client'
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

export default function DisclaimerModal() {
    const [isOpen, setIsOpen] = useState(false)

    useEffect(() => {
        setIsOpen(true)
    }, [])

    if (!isOpen) return null

    return (
        <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="anim-pop glass-strong w-full max-w-sm overflow-hidden rounded-3xl shadow-2xl">

                {/* Header */}
                <div className="relative flex items-center justify-between overflow-hidden bg-gradient-to-br from-navy-600 to-navy-900 p-5 text-white">
                    <div className="pointer-events-none absolute -mr-12 -mt-12 right-0 top-0 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
                    <h3 className="relative z-10 text-xl font-bold">Notice / सूचना</h3>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="relative z-10 rounded-full p-2 transition-colors hover:bg-white/20"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="space-y-6 p-6">

                    {/* English Section */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-navy-300">English</h4>
                        <p className="font-medium leading-relaxed text-white/90">
                            Due to security reasons INR deposit was closed for 24 hours and now it is working perfectly.
                        </p>
                    </div>

                    <button
                        onClick={() => setIsOpen(false)}
                        className="btn-navy mt-2 w-full rounded-xl py-3.5 font-bold"
                    >
                        Close
                    </button>
                </div>

            </div>
        </div>
    )
}
