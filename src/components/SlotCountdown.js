// HH : MM : SS chips for the slot timer. Shows a dimmed 24:00:00 while the
// timer is stopped (no purchase running).
export default function SlotCountdown({ left }) {
    const running = Boolean(left)
    const parts = running ? [left.h, left.m, left.s] : ['24', '00', '00']

    const chip = running
        ? 'bg-navy-500/25 text-navy-200'
        : 'bg-white/5 text-white/40'
    const colon = running ? 'text-navy-300' : 'text-white/30'

    return (
        <div className="flex shrink-0 items-center gap-1" aria-label={running ? 'Time left' : 'Timer stopped'}>
            {parts.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className={`text-xs font-bold ${colon}`}>:</span>}
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${chip}`}>{part}</span>
                </span>
            ))}
        </div>
    )
}
