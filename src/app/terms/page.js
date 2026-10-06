'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText } from 'lucide-react'

const SECTIONS = [
    {
        title: '1. Acceptance of Terms',
        points: [
            'By creating an account and using this platform you agree to these Terms & Conditions in full.',
            'If you do not agree with any part of these terms, please stop using the platform immediately.',
            'These terms may be updated from time to time. Continued use of the platform means you accept the updated terms.',
        ],
    },
    {
        title: '2. Account & Eligibility',
        points: [
            'You must be at least 18 years old to use this platform.',
            'One person may hold only one account. Multiple accounts created by the same person may be banned without notice.',
            'You are responsible for keeping your login details and payment PIN confidential.',
            'All information you provide (UPI ID, account name, contact details) must be accurate and belong to you.',
        ],
    },
    {
        title: '3. Deposits (Buying a Slot)',
        points: [
            'The minimum INR slot is ₹500. The minimum USDT deposit is 10 USDT.',
            'You can deposit from any of your own UPI IDs. Enter the UPI ID you actually paid from — every ID you use is saved to your account.',
            'A valid UTR / reference number must be submitted for every payment. Deposits without a correct UTR will not be approved.',
            'The same UTR cannot be submitted twice.',
            'Deposits are credited only after admin verification. Verification may take time during heavy load.',
        ],
    },
    {
        title: '4. Withdrawals',
        points: [
            'An INR deposit is locked for the first 24 hours after it is approved. After that, your whole balance is withdrawable. USDT deposits are never locked.',
            'Withdrawals can be requested at any time, with a maximum of 3 withdrawal requests per day. Rejected requests also count towards the 3.',
            'You can save several UPI IDs and choose any of them for each withdrawal. The UPI IDs must belong to you.',
            'The requested amount is taken from your wallet when you submit the request. If the request is rejected, the amount is returned to your wallet.',
            'Withdrawal requests are processed after admin approval, normally within 24 hours.',
            'A withdrawal request may be rejected if the account shows suspicious activity, mismatched payment details, or a violation of these terms.',
        ],
    },
    {
        title: '5. Tools & UPI IDs',
        points: [
            'A UPI ID may be linked to only one account on the platform. Re-using a UPI ID that is already registered will result in a permanent ban.',
            'You may add a maximum of 5 UPI IDs per day. Attempting to bypass this limit will result in a permanent ban.',
            'Only one tool may run at a time.',
            'Every UPI ID is verified by the admin before it can be operated.',
        ],
    },
    {
        title: '6. Slot Commission (5%)',
        points: [
            'Your wallet earns a 5% commission every 24 hours, starting 24 hours after your first slot purchase is approved.',
            'The commission is 5% of your wallet balance, including earlier commission and bonus. Money deposited less than 24 hours before a payout is counted from the next payout.',
            'A withdrawal lowers the amount the commission is paid on, but does not stop the timer. The commission stops only when your wallet balance reaches zero.',
            'Commission rates and slot amounts may change at any time without prior notice.',
            'Earnings shown in the app are subject to verification and may be adjusted if an error or fraudulent activity is found.',
        ],
    },
    {
        title: '7. Referral Programme',
        points: [
            'You earn a bonus on every slot bought by a user who registered with your invitation link.',
            'You earn 0.10% of each slot they buy.',
            'The referral bonus is paid for a maximum of 5 referrals. Signups beyond that limit will not be linked to your team.',
            'The referral bonus is credited when the referred user\'s deposit is approved.',
            'Self-referrals, fake accounts and referrals created to farm bonuses will result in a permanent ban and forfeiture of the bonus.',
        ],
    },
    {
        title: '8. Prohibited Activity',
        points: [
            'Using another person\'s UPI ID, bank account or identity documents.',
            'Submitting fake UTR numbers, edited screenshots or false transaction hashes.',
            'Creating multiple accounts, or using automated scripts and bots on the platform.',
            'Any attempt to manipulate balances, bonuses or the withdrawal system.',
            'Violation of any of the above may result in an immediate permanent ban and forfeiture of the account balance.',
        ],
    },
    {
        title: '9. Account Suspension',
        points: [
            'We may suspend or ban any account that violates these terms, without prior notice.',
            'A banned account loses access to withdrawals and any pending requests on that account.',
            'If you believe your account was banned in error, contact support through the official Telegram or WhatsApp channel.',
        ],
    },
    {
        title: '10. Support & Communication',
        points: [
            'Official support is provided only through the Telegram and WhatsApp links listed on the Support page inside the app.',
            'We will never ask for your password or payment PIN. Anyone asking for these is not our staff.',
            'Do not send money to any personal account shared by someone claiming to be an agent. Use only the UPI ID shown on the payment screen.',
        ],
    },
    {
        title: '11. Limitation of Liability',
        points: [
            'The platform is provided on an "as is" basis. Service may be interrupted for maintenance or upgrades.',
            'We are not responsible for losses caused by incorrect payment details entered by you, network failures at your bank, or delays outside our control.',
            'Our maximum liability in any case is limited to the verified balance held in your account.',
        ],
    },
]

export default function TermsPage() {
    const router = useRouter()

    return (
        <div className="min-h-screen pb-28">
            {/* Header */}
            <div className="glass sticky top-0 z-10 flex items-center gap-4 px-5 py-4">
                <button onClick={() => router.back()} className="text-[var(--text-muted)] transition-colors hover:text-white">
                    <ArrowLeft className="h-6 w-6" />
                </button>
                <h1 className="text-xl font-bold text-white">Terms &amp; Conditions</h1>
            </div>

            <div className="space-y-4 p-4">
                <div className="glow-navy rounded-3xl bg-gradient-to-br from-navy-600 via-navy-800 to-black p-6 text-white">
                    <div className="mb-2 flex items-center gap-2">
                        <FileText className="h-5 w-5 text-navy-200" />
                        <h2 className="text-lg font-bold">Please read carefully</h2>
                    </div>
                    <p className="text-sm leading-relaxed text-navy-50/80">
                        These terms govern deposits, withdrawals and the use of tools on this platform. Using the app means
                        you accept them.
                    </p>
                </div>

                {SECTIONS.map((section) => (
                    <div key={section.title} className="glass rounded-2xl p-5">
                        <h3 className="mb-3 text-base font-bold text-white">{section.title}</h3>
                        <ul className="space-y-2.5">
                            {section.points.map((point, i) => (
                                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-white/75">
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-navy-300" />
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}

                <div className="glass rounded-2xl p-5 text-center">
                    <p className="text-xs leading-relaxed text-[var(--text-dim)]">
                        For any question about these terms, reach us on the Support page.
                    </p>
                    <button
                        onClick={() => router.push('/support')}
                        className="btn-navy mt-4 rounded-xl px-6 py-2 text-sm font-bold"
                    >
                        Contact Support
                    </button>
                </div>
            </div>
        </div>
    )
}
