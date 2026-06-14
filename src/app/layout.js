import Link from 'next/link'
import BottomNav from '@/components/BottomNav'
import MaintenanceGuard from '@/components/MaintenanceGuard'
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ... existing font configuration ...

export const metadata = {
  title: "USDT Deposit App",
  description: "Secure USDT Deposits and Tracking",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#05070b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased pb-16 text-[var(--text)]`}
      >
        <main className="max-w-5xl mx-auto min-h-screen relative overflow-hidden border-x border-white/5">
          <MaintenanceGuard>
            {children}
          </MaintenanceGuard>
        </main>
        <div className="max-w-5xl mx-auto">
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
