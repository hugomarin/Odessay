"use client"

import { useEffect, useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { getAuthService } from "@/lib/services/auth-service-factory"

type ReadyState = {
  id: string
  email: string
  displayName: string
  username: string
}

type HarnessState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; account: ReadyState }

export function SettingsAccountEvidenceClient() {
  const searchParams = useSearchParams()
  const [state, setState] = useState<HarnessState>({ status: "loading" })
  const [lastResult, setLastResult] = useState("idle")
  const [isPending, startTransition] = useTransition()

  const currentPassword = searchParams.get("password") ?? ""
  const nextDisplayName = searchParams.get("nextDisplayName") ?? ""
  const nextUsername = searchParams.get("nextUsername") ?? ""
  const nextEmail = searchParams.get("nextEmail") ?? ""
  const nextPassword = searchParams.get("nextPassword") ?? ""

  useEffect(() => {
    let cancelled = false

    const email = searchParams.get("email") ?? ""
    const password = searchParams.get("password") ?? ""

    if (!email || !password) {
      setState({ status: "error", message: "Missing harness credentials." })
      return
    }

    void getAuthService().signIn({ email, password }).then((result) => {
      if (cancelled) {
        return
      }

      const user = result.data?.user

      if (result.error || !user?.email) {
        setState({
          status: "error",
          message: result.error?.message ?? "Could not initialize the settings harness.",
        })
        return
      }

      setState({
        status: "ready",
        account: {
          id: user.id,
          email: user.email,
          displayName: user.displayName ?? "",
          username: user.username ?? "",
        },
      })
    })

    return () => {
      cancelled = true
    }
  }, [searchParams])

  const runStep = (name: string, work: () => Promise<unknown>) => {
    startTransition(async () => {
      setLastResult(`pending:${name}`)
      try {
        const result = await work()
        setLastResult(`ok:${name}:${JSON.stringify(result)}`)
      } catch (error) {
        setLastResult(
          `error:${name}:${error instanceof Error ? error.message : "Unexpected harness error"}`,
        )
      }
    })
  }

  if (state.status === "loading") {
    return <div data-testid="ode-221-settings-harness">Signing in for harness...</div>
  }

  if (state.status === "error") {
    return <div data-testid="ode-221-settings-harness-error">{state.message}</div>
  }

  return (
    <div data-testid="ode-221-settings-harness" className="space-y-4 p-6">
      <h1>ODE-221 Settings Harness</h1>
      <p data-testid="ode-221-account-email">{state.account.email}</p>
      <p data-testid="ode-221-last-result">{lastResult}</p>
      <button
        data-testid="ode-221-update-display-name"
        disabled={isPending}
        onClick={() =>
          runStep("displayName", async () =>
            getAuthService().updateDisplayName({ displayName: nextDisplayName }),
          )
        }
        type="button"
      >
        Update display name
      </button>
      <button
        data-testid="ode-221-update-username"
        disabled={isPending}
        onClick={() =>
          runStep("username", async () => getAuthService().updateUsername({ username: nextUsername }))
        }
        type="button"
      >
        Update username
      </button>
      <button
        data-testid="ode-221-update-email"
        disabled={isPending}
        onClick={() =>
          runStep("email", async () => getAuthService().requestEmailChange({ email: nextEmail }))
        }
        type="button"
      >
        Update email
      </button>
      <button
        data-testid="ode-221-update-password"
        disabled={isPending}
        onClick={() =>
          runStep("password", async () =>
            getAuthService().updatePassword({
              currentPassword,
              newPassword: nextPassword,
            }),
          )
        }
        type="button"
      >
        Update password
      </button>
    </div>
  )
}
