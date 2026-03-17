import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { Lora } from "next/font/google"
import { SyncBootstrap } from "@/components/sync/sync-bootstrap"
import "./globals.css"

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  style: ["normal", "italic"],
  weight: ["400", "500"],
  display: "swap"
})

export const metadata: Metadata = {
  title: "Odessay",
  description: "A sanctuary for epistolary writing"
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${lora.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink">
        <SyncBootstrap />
        {children}
      </body>
    </html>
  )
}
