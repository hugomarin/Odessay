import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { DM_Sans, Lora } from "next/font/google"
import { SyncBootstrap } from "@/components/sync/sync-bootstrap"
import {
  DEFAULT_WRITING_STYLE,
  WRITING_STYLE_STORAGE_KEY,
  WRITING_STYLE_VALUES,
} from "@/lib/settings/writing-style"
import "./globals.css"

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500", "600"]
})

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  style: ["normal", "italic"],
  weight: ["400", "500"],
  display: "swap"
})

/**
 * The favicon renders at 16–32px, so it is the two-blade mark on an ink tile,
 * inlined as a data URI — `docs/design/brand.md`. `public/favicon.png` stays as
 * the raster fallback for clients that ignore SVG icons.
 */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1E1915"/><g transform="translate(32 32) scale(0.62) translate(-32 -33)"><path d="M11.1 49.4 L38.97 26.6 L45.93 38 Z" fill="#B5ADA5" stroke="#B5ADA5" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/><path d="M11.34 49.8 L46.18 38.4 L53.14 49.8 Z" fill="#F5F3EF" stroke="#F5F3EF" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/></g></svg>`

const WRITING_STYLE_BOOTSTRAP_SCRIPT = `(() => { try { const value = window.localStorage.getItem(${JSON.stringify(WRITING_STYLE_STORAGE_KEY)}); if (${JSON.stringify(WRITING_STYLE_VALUES)}.includes(value)) document.documentElement.dataset.writingStyle = value; } catch {} })();`

export const metadata: Metadata = {
  title: "Artifact Studio",
  description: "A sanctuary for epistolary writing",
  icons: {
    icon: [
      {
        url: `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`,
        type: "image/svg+xml"
      },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" }
    ]
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-writing-style={DEFAULT_WRITING_STYLE}
      className={`${GeistSans.variable} ${dmSans.variable} ${lora.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: WRITING_STYLE_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-ink">
        <SyncBootstrap />
        {children}
      </body>
    </html>
  )
}
