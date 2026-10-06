'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Headset, Megaphone, Wallet, Check } from 'lucide-react' // Icons
import Image from 'next/image'
import { useSlotCycle } from '@/hooks/useSlotCycle'
import { useAdminSetting, useCachedQuery, useSessionUser } from '@/hooks/useCachedQuery'
import SlotCountdown from '@/components/SlotCountdown'

// Milestones on the Daily Total Recharge bar
const MILESTONES = [1000, 2000, 5000, 7000, 10000]
const MIN_INR = 500
const MAX_SLOT_INR = 10000
const BONUS_RATE = 0.05

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

// 8-10 slots: the first 3-4 between 500 and 1,500, the rest up to 10,000
const generateSlots = () => {
  const count = randInt(8, 10)
  const lowCount = randInt(3, 4)
  const pick = (n, min, max) => {
    const values = new Set()
    while (values.size < n) values.add(randInt(min, max))
    return [...values].sort((a, b) => a - b)
  }
  return [...pick(lowCount, MIN_INR, 1500), ...pick(count - lowCount, 1501, MAX_SLOT_INR)]
}

// Shown on the first render (server and client must match), then replaced
// by random amounts that change every 4-5 seconds
const INITIAL_SLOTS = [525, 587, 670, 980, 1850, 3240, 5470, 7680, 9890]

export default function Home() {
  const user = useSessionUser()
  // Read once: the React Compiler would otherwise read user.id while user is still null
  const userId = user?.id
  const [customAmount, setCustomAmount] = useState('')
  const [customError, setCustomError] = useState('')
  const [slots, setSlots] = useState(INITIAL_SLOTS)
  const router = useRouter()
  const telegramLink = useAdminSetting('telegram_link', 'https://t.me/ZPayService')

  const { data: balance } = useCachedQuery(userId ? `balance:${userId}` : null, async () => {
    const { data, error } = await createClient().from('profiles').select('balance').eq('id', userId).single()
    if (error) throw error
    return data.balance
  })

  // Same timer as the Assets page: stopped until a slot purchase, then
  // counts down to the next 5% payout until the wallet is emptied. The
  // total is the wallet amount that payout is 5% of.
  const { left: cycleLeft, total: todayRecharge } = useSlotCycle(user?.id)

  useEffect(() => {
    let timer
    const shuffle = () => {
      setSlots(generateSlots())
      timer = setTimeout(shuffle, randInt(4000, 5000))
    }
    timer = setTimeout(shuffle, randInt(4000, 5000))
    return () => clearTimeout(timer)
  }, [])

  // Milestones are evenly spaced on the bar, so the fill is interpolated
  // between the last reached dot and the next one rather than linearly.
  const reachedCount = MILESTONES.filter((m) => todayRecharge >= m).length
  const nextMilestone = MILESTONES[reachedCount] ?? null

  const progressPercent = (() => {
    const last = MILESTONES.length - 1
    if (reachedCount === 0) return 0
    if (reachedCount > last) return 100

    const from = MILESTONES[reachedCount - 1]
    const to = MILESTONES[reachedCount]
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
    if (Number(balance) > 0) {
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
              5% every 24h
            </span>
          </div>
          <p className="mb-4 text-xs text-[var(--text-dim)]">
            Pick a slot and pay by UPI. You get 5% of your wallet every 24 hours after approval.
          </p>

          <div className="space-y-3">
            {slots.map((amount, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-navy-400/30 bg-navy-500/15 font-bold text-navy-300">
                    ₹
                  </div>
                  <div>
                    <p key={amount} className="anim-fade text-lg font-bold leading-tight tabular-nums text-white">
                      ₹{amount.toLocaleString('en-IN')}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-dim)]">
                      Income: ₹{(amount * BONUS_RATE).toLocaleString('en-IN', { maximumFractionDigits: 2 })} every 24h
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
                Minimum ₹{MIN_INR.toLocaleString('en-IN')} — no upper limit. INR deposits are locked for the first 24 hours only.
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold text-white/90">Daily Total Recharge</h3>
            {/* Stopped until a slot purchase, then 24h - same timer as Assets */}
            <SlotCountdown left={cycleLeft} />
          </div>

          <div className="mb-1 text-2xl font-bold tabular-nums text-white">
            ₹{todayRecharge.toLocaleString('en-IN')}
          </div>
          <p className="mb-6 text-xs text-[var(--text-dim)]">
            {!cycleLeft
              ? 'Timer starts when your slot purchase is approved'
              : nextMilestone
                ? `₹${(nextMilestone - todayRecharge).toLocaleString('en-IN')} more to reach ₹${nextMilestone.toLocaleString('en-IN')}`
                : 'All milestones completed 🎉'}
          </p>

          {/* Progress Steps */}
          <div className="relative flex items-center justify-between">
            {/* Track runs exactly from the first dot's centre to the last one's */}
            <div className="absolute inset-x-3 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {MILESTONES.map((val) => {
              const reached = todayRecharge >= val
              return (
                <div
                  key={val}
                  className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${reached
                    ? 'border-[var(--background-2)] bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_4px_12px_-4px_rgba(16,185,129,0.9)]'
                    : 'border-white/15 bg-[var(--background-2)]'
                    }`}
                >
                  {reached ? (
                    <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.5} />
                  ) : (
                    <span className="text-[10px] font-bold leading-none text-white/50">+</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Labels share the dots' width so each sits centred under its dot */}
          <div className="mt-2 flex justify-between pb-1">
            {MILESTONES.map((val) => (
              <span
                key={val}
                className={`w-6 shrink-0 whitespace-nowrap text-center text-[10px] font-bold ${todayRecharge >= val ? 'text-emerald-300' : 'text-white/50'}`}
              >
                {val >= 1000 ? `${val / 1000}k` : val}
              </span>
            ))}
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
