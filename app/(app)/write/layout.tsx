type WriteLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default function WriteLayout({ children }: WriteLayoutProps) {
  return <div className="min-h-screen bg-bg">{children}</div>
}
