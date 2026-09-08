'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Headset, Megaphone, Wallet, Check } from 'lucide-react' // Icons
import Image from 'next/image'

// Fixed INR slots, plus a custom amount from MIN_INR upwards
const SLOT_AMOUNTS = [1000, 2000, 5000, 7000, 10000]
const MIN_INR = 1000
const BONUS_RATE = 0.05

export default function Home() {
  const [user, setUser] = useState(null)
  const [balance, setBalance] = useState('0.00')
  const [loading, setLoading] = useState(true)
  const [telegramLink, setTelegramLink] = useState('https://t.me/ZPayService')
  const [customAmount, setCustomAmount] = useState('')
  const [customError, setCustomError] = useState('')
  const [todayRecharge, setTodayRecharge] = useState(0)
  const [resetIn, setResetIn] = useState({ h: '00', m: '00', s: '00' })
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const getUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUser(user)
        const { data } = await supabase.from('profiles').select('balance').eq('id', user.id).single()
        if (data) setBalance(data.balance)

        // Today's recharge = approved deposits made since local midnight.
        // Only the paid amount counts, not the bonus on top of it.
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)

        const { data: deposits } = await supabase
          .from('transactions')
          .select('amount')
          .eq('user_id', user.id)
          .eq('type', 'deposit')
          .eq('status', 'approved')
          .gte('created_at', startOfDay.toISOString())

        if (deposits) {
          setTodayRecharge(deposits.reduce((sum, d) => sum + Number(d.amount || 0), 0))
        }
      } else {
        router.push('/login')
      }
      setLoading(false)
    }
    getUserData()

    const fetchTelegramLink = async () => {
      const { data } = await supabase.rpc('get_admin_setting', { setting_key: 'telegram_link' })
      if (data) setTelegramLink(data)
    }
    fetchTelegramLink()
  }, [router, supabase])

  // Live countdown to midnight, when the daily recharge total resets
  useEffect(() => {
    const pad = (n) => String(n).padStart(2, '0')

    const tick = () => {
      const now = new Date()
      const midnight = new Date(now)
      midnight.setHours(24, 0, 0, 0)
      const diff = Math.max(0, midnight - now)

      setResetIn({
        h: pad(Math.floor(diff / 3600000)),
        m: pad(Math.floor(diff / 60000) % 60),
        s: pad(Math.floor(diff / 1000) % 60),
      })
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Milestones are evenly spaced on the bar, so the fill is interpolated
  // between the last reached dot and the next one rather than linearly.
  const reachedCount = SLOT_AMOUNTS.filter((m) => todayRecharge >= m).length
  const nextMilestone = SLOT_AMOUNTS[reachedCount] ?? null

  const progressPercent = (() => {
    const last = SLOT_AMOUNTS.length - 1
    if (reachedCount === 0) return 0
    if (reachedCount > last) return 100

    const from = SLOT_AMOUNTS[reachedCount - 1]
    const to = SLOT_AMOUNTS[reachedCount]
    const within = (todayRecharge - from) / (to - from)
    return ((reachedCount - 1 + within) / last) * 100
  })()

  const handleInvest = (amount) => {
    router.push(`/payment?amount=${amount}`)
  }

  const handleCustomInvest = () => {
    const amount = parseFloat(customAmount)
    if (isNaN(amount) || amount < MIN_INR) {
      setCustomError(`Minimum investment is ₹${MIN_INR.toLocaleString('en-IN')}`)
      return
    }
    setCustomError('')
    handleInvest(amount)
  }

  const handleWithdrawClick = () => {
    const balanceNum = parseFloat(balance)
    if (balanceNum > 0) {
      router.push('/tool')
    } else {
      alert('Please topup first')
    }
  }

  const [withdrawalEnabled, setWithdrawalEnabled] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('withdrawalEnabled')
    if (stored) setWithdrawalEnabled(JSON.parse(stored))
  }, [])

  const toggleWithdrawal = (e) => {
    e.stopPropagation() // Prevent card click
    const newState = !withdrawalEnabled
    setWithdrawalEnabled(newState)
    localStorage.setItem('withdrawalEnabled', JSON.stringify(newState))
  }

  if (loading || !user) return null

  return (
    <div className="min-h-screen pb-28">
      {/* <DisclaimerModal /> */}

      {/* 1. Header */}
      <div className="glass sticky top-0 z-10 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Image src="/logo-epay.png" alt="E Pay Logo" width={1200} height={387} priority className="h-8 w-auto object-contain" />
          {/* <span className="text-sm font-semibold tracking-tight text-white/90">E Pay</span> */}
        </div>
        <a
          href={telegramLink}
          target="_blank"
          rel="noopener noreferrer"
          className="glass-strong flex h-10 w-10 items-center justify-center rounded-xl text-navy-300 transition-colors hover:text-white"
        >
          <Headset className="h-5 w-5" />
        </a>
      </div>

      <div className="space-y-4 p-4">
        {/* 2. Brand Banner */}
        <div className="glow-navy anim-slide-up relative flex w-full items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-[#0c1730] to-black px-6 py-9">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-navy-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-10 h-40 w-40 rounded-full bg-orange-500/10 blur-3xl" />
          <Image
            src="/logo-epay.png"
            alt="E Pay"
            width={1200}
            height={387}
            priority
            className="relative z-10 h-14 w-auto object-contain"
          />
        </div>

        {/* 3. INR Slots (Invest) */}
        <div className="glass anim-slide-up rounded-3xl p-5">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Invest in INR</h3>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-bold text-emerald-300">
              5% in 24h
            </span>
          </div>
          <p className="mb-4 text-xs text-[var(--text-dim)]">
            Pick a slot and pay by UPI. Commission is credited 24 hours after approval.
          </p>

          <div className="space-y-3">
            {SLOT_AMOUNTS.map((amount) => (
              <div
                key={amount}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-navy-400/30 bg-navy-500/15 font-bold text-navy-300">
                    ₹
                  </div>
                  <div>
                    <p className="text-lg font-bold leading-tight text-white">
                      ₹{amount.toLocaleString('en-IN')}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-dim)]">
                      Income: ₹{(amount * BONUS_RATE).toLocaleString('en-IN')} (5% after 24h)
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleInvest(amount)}
                  className="btn-navy shrink-0 rounded-xl px-6 py-2 text-xs font-bold"
                >
                  Invest
                </button>
              </div>
            ))}
          </div>

          {/* Custom amount */}
          <div className="mt-5 rounded-2xl border border-navy-400/25 bg-navy-500/10 p-4">
            <label className="mb-2 block text-sm font-bold text-white/90">Custom Amount</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-medium text-[var(--text-muted)]">₹</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value)
                    if (customError) setCustomError('')
                  }}
                  min={MIN_INR}
                  step="1"
                  placeholder={MIN_INR.toString()}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-8 pr-4 font-bold text-white outline-none focus:border-navy-400 focus:ring-2 focus:ring-navy-500/30"
                />
              </div>
              <button
                onClick={handleCustomInvest}
                className="btn-navy shrink-0 rounded-xl px-6 py-3 text-sm font-bold"
              >
                Invest
              </button>
            </div>
            {customError ? (
              <p className="mt-2 text-xs font-medium text-red-400">{customError}</p>
            ) : (
              <p className="mt-2 text-xs text-[var(--text-dim)]">
                Minimum ₹{MIN_INR.toLocaleString('en-IN')} — no upper limit.
              </p>
            )}
          </div>
        </div>

        {/* 4. Marquee */}
        <div className="glass flex items-center gap-3 overflow-hidden rounded-full px-4 py-2.5">
          <Megaphone className="h-4 w-4 shrink-0 animate-pulse text-navy-300" />
          <div className="truncate text-xs font-medium text-[var(--text-muted)]">
            Check out our latest updates! System upgrade complete.
          </div>
        </div>

        {/* 5. Daily Total Recharge (Progress) */}
        <div className="glass rounded-3xl p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white/90">Daily Total Recharge</h3>
            {/* Resets at midnight */}
            <div className="flex items-center gap-1">
              <span className="rounded-md bg-navy-500/20 px-1.5 py-0.5 text-xs font-bold text-navy-300">{resetIn.h}</span>
              <span className="font-bold text-navy-300">:</span>
              <span className="rounded-md bg-navy-500/20 px-1.5 py-0.5 text-xs font-bold text-navy-300">{resetIn.m}</span>
              <span className="font-bold text-navy-300">:</span>
              <span className="rounded-md bg-navy-500/20 px-1.5 py-0.5 text-xs font-bold text-navy-300">{resetIn.s}</span>
            </div>
          </div>

          <div className="mb-1 text-2xl font-bold text-white">
            ₹{todayRecharge.toLocaleString('en-IN')}
          </div>
          <p className="mb-6 text-xs text-[var(--text-dim)]">
            {nextMilestone
              ? `₹${(nextMilestone - todayRecharge).toLocaleString('en-IN')} more to reach ₹${nextMilestone.toLocaleString('en-IN')}`
              : 'All milestones completed today 🎉'}
          </p>

          {/* Progress Steps */}
          <div className="relative pb-2 pt-6">
            {/* Bar */}
            <div className="absolute left-0 right-0 top-[30px] h-2 rounded-full bg-white/10" />
            {/* Filled portion */}
            <div
              className="absolute left-0 top-[30px] h-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />

            {/* Items */}
            <div className="relative z-10 flex justify-between">
              {SLOT_AMOUNTS.map((val) => {
                const reached = todayRecharge >= val
                return (
                  <div key={val} className="flex flex-col items-center gap-2">
                    <div
                      className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#0a0e16] transition-colors ${reached
                        ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_4px_12px_-4px_rgba(16,185,129,0.9)]'
                        : 'bg-white/15'
                        }`}
                    >
                      {reached ? (
                        <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.5} />
                      ) : (
                        <span className="text-[10px] font-bold leading-none text-white/50">+</span>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold ${reached ? 'text-emerald-300' : 'text-white/50'}`}>
                      {val >= 1000 ? `${val / 1000}k` : val}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 6. Withdraw Card */}
        <div
          onClick={handleWithdrawClick}
          className="glow-navy relative cursor-pointer overflow-hidden rounded-3xl bg-gradient-to-br from-navy-600 via-navy-700 to-navy-900 p-6 text-white transition-transform active:scale-[0.98]"
        >
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-navy-400/20 blur-3xl" />
          <div className="relative z-10 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold">Withdraw <span className="text-white/50">(closing)</span></h3>
              <div className="mt-8 flex gap-8 text-xs text-navy-50/70">
                <div className="flex flex-col">
                  <span>In Transaction</span>
                  <span className="mt-1 text-lg font-bold text-white">0</span>
                </div>
                <div className="flex flex-col">
                  <span>Today&apos;s Withdraw</span>
                  <span className="mt-1 text-lg font-bold text-white">0</span>
                </div>
              </div>
            </div>
            {/* Toggle Switch */}
            <div
              onClick={toggleWithdrawal}
              className={`h-6 w-12 cursor-pointer rounded-full p-1 transition-colors ${withdrawalEnabled ? 'bg-emerald-400' : 'bg-white/20'}`}
            >
              <div className={`h-4 w-4 rounded-full bg-white shadow-md transition-transform ${withdrawalEnabled ? 'translate-x-6' : ''}`} />
            </div>
          </div>

          {/* Background Decoration */}
          <div className="pointer-events-none absolute bottom-0 right-0 opacity-10">
            <Wallet className="h-32 w-32" />
          </div>
        </div>

      </div>
    </div>
  )
}
