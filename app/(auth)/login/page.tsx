import { Suspense } from "react"
import { LoginForm } from "@/components/auth/login-form"
import { DesktopStartupRedirect } from "@/components/navigation/desktop-startup-redirect"

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <DesktopStartupRedirect />
      <LoginForm />
    </Suspense>
  )
}
