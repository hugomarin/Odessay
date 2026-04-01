type PublicAuthorLayoutProps = {
  children: React.ReactNode
}

export default function PublicAuthorLayout({ children }: PublicAuthorLayoutProps) {
  return <div className="min-h-screen bg-bg">{children}</div>
}
