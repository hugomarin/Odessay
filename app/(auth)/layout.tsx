/**
 * The card is the only elevated surface of this flow — no second card, no
 * illustration, no marketing copy. The landing page does that job.
 */
export default function AuthLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return <main className="od-auth-stage">{children}</main>
}
