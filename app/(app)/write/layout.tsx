type WriteLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default function WriteLayout({ children }: WriteLayoutProps) {
  // `h-full` (not `min-h-screen`): the write route fills the app shell's <main>
  // exactly so the editor frame can never overflow it and make it scroll.
  return <div className="h-full min-h-0 bg-bg">{children}</div>
}
