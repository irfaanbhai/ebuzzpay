'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Headset, Megaphone, DollarSign, Wallet } from 'lucide-react' // Icons
import Link from 'next/link'
import Image from 'next/image'
import DisclaimerModal from '@/components/DisclaimerModal'

export default function Home() {
  const [user, setUser] = useState(null)
  const [balance, setBalance] = useState('0.00')
  const [loading, setLoading] = useState(true)
  const [usdtRate, setUsdtRate] = useState(102.0)
  const [telegramLink, setTelegramLink] = useState('https://t.me/ZPayService')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const getUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUser(user)
        const { data } = await supabase.from('profiles').select('balance').eq('id', user.id).single()
        if (data) setBalance(data.balance)
      } else {
        router.push('/login')
      }
      setLoading(false)
    }
    getUserData()

    const fetchRate = async () => {
      const { data } = await supabase.rpc('get_admin_setting', { setting_key: 'usdt_rate' })
      if (data && !isNaN(parseFloat(data))) setUsdtRate(parseFloat(data))
    }
    fetchRate()

    const fetchTelegramLink = async () => {
      const { data } = await supabase.rpc('get_admin_setting', { setting_key: 'telegram_link' })
      if (data) setTelegramLink(data)
    }
    fetchTelegramLink()
  }, [router, supabase])

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
      <DisclaimerModal />

      {/* 1. Header */}
      <div className="glass sticky top-0 z-10 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Image src="/logo2.png" alt="EbuzzPay Logo" width={1117} height={194} priority className="h-8 w-auto object-contain" />
          {/* <span className="text-sm font-semibold tracking-tight text-white/90">EbuzzPay</span> */}
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
        {/* 2. Banner (Recharge Tips) */}
        <div className="glow-navy anim-slide-up relative min-h-[170px] w-full overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-[#0c1730] to-black p-5">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-navy-500/20 blur-3xl" />
          <h2 className="relative z-10 mb-3 text-lg font-bold text-white">Recharge Tips</h2>
          <div className="relative z-10 space-y-2 text-xs">
            <div className="flex w-4/5 items-center gap-2 rounded-r-full border border-white/10 bg-white/5 p-2 font-semibold text-white/90 backdrop-blur-sm">
              <span>🖥️</span> Tools must be ONLINE &amp; ACTIVE
            </div>
            <div className="flex w-4/5 items-center gap-2 rounded-r-full border border-white/10 bg-white/5 p-2 font-semibold text-white/90 backdrop-blur-sm">
              <span>🔗</span> Link Tools with User ID
            </div>
            <div className="flex w-4/5 items-center gap-2 rounded-r-full border border-white/10 bg-white/5 p-2 font-semibold text-white/90 backdrop-blur-sm">
              <span>☁️</span> Submit UTR within 30mins
            </div>
          </div>
        </div>

        {/* 3. USDT Rate Card */}
        <div className="glass relative flex items-center justify-between overflow-hidden rounded-3xl p-5">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">USDT rate</p>
            <h3 className="mb-3 text-2xl font-black tracking-tight text-gradient">1 USDT = {usdtRate.toFixed(1)} INR</h3>
            <Link href="/deposit" className="btn-navy inline-block rounded-full px-7 py-2 text-xs font-bold">
              TOP UP
            </Link>
          </div>
          <div className="anim-float flex h-14 w-14 items-center justify-center rounded-full border border-navy-400/40 bg-gradient-to-br from-navy-400 to-navy-700 text-xl font-black italic text-white shadow-[0_10px_30px_-8px_rgba(51,94,201,0.7)]">
            U
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
            {/* Countdown */}
            <div className="flex items-center gap-1">
              <span className="rounded-md bg-navy-500/20 px-1.5 py-0.5 text-xs font-bold text-navy-300">09</span>
              <span className="font-bold text-navy-300">:</span>
              <span className="rounded-md bg-navy-500/20 px-1.5 py-0.5 text-xs font-bold text-navy-300">37</span>
              <span className="font-bold text-navy-300">:</span>
              <span className="rounded-md bg-navy-500/20 px-1.5 py-0.5 text-xs font-bold text-navy-300">07</span>
            </div>
          </div>

          <div className="mb-6 text-2xl font-bold text-white">₹{balance}</div>

          {/* Progress Steps */}
          <div className="relative pb-2 pt-6">
            {/* Bar */}
            <div className="absolute left-0 right-0 top-[30px] h-2 rounded-full bg-white/10" />

            {/* Items */}
            <div className="relative z-10 flex justify-between">
              {[100, 200, 300, 400, 500, 600, 700].map((val) => (
                <div key={val} className="flex flex-col items-center gap-2">
                  <div className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#0a0e16] bg-gradient-to-br from-navy-400 to-navy-700 shadow-[0_4px_12px_-4px_rgba(51,94,201,0.8)]">
                    <div className="absolute -bottom-1 -right-1 rounded bg-emerald-500 px-0.5 text-[8px] leading-none text-white shadow">+</div>
                  </div>
                  <span className="text-[10px] font-bold text-white/70">{val}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between px-1 text-[8px] text-[var(--text-dim)]">
              <span>10k</span><span>20k</span><span>30k</span><span>40k</span><span>50k</span><span>60k</span><span>70k</span>
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
