/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AuthCard,
  AuthPasswordField,
  LocalOnlyRow,
  passwordHint
} from "@/components/auth/auth-card"

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode
    href: string
    [key: string]: unknown
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

let container: HTMLDivElement
let root: Root | null = null

function mount(node: React.ReactNode) {
  root = createRoot(container)
  act(() => {
    root?.render(node)
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container.remove()
})

/**
 * The brief spells the hint out verbatim, so it is pinned here rather than left
 * to whoever edits the component next.
 */
describe("password hint", () => {
  it("progresses from the minimum, through the countdown, to ready", () => {
    expect(passwordHint("")).toBe("Minimum 8 characters.")
    expect(passwordHint("abcd")).toBe("4 to go.")
    expect(passwordHint("abcdefg")).toBe("1 to go.")
    expect(passwordHint("abcdefgh")).toBe("Ready.")
    expect(passwordHint("abcdefghijkl")).toBe("Ready.")
  })
})

describe("password reveal", () => {
  it("toggles the input type and announces the state to screen readers", () => {
    mount(<AuthPasswordField label="Password" onChange={() => {}} value="secret123" />)

    const input = container.querySelector("input") as HTMLInputElement
    expect(input.type).toBe("password")
    expect(container.textContent).toContain("Password hidden")

    const toggle = container.querySelector(".od-auth-reveal") as HTMLButtonElement
    expect(toggle.getAttribute("aria-label")).toBe("Show password")
    expect(toggle.getAttribute("aria-pressed")).toBe("false")

    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect((container.querySelector("input") as HTMLInputElement).type).toBe("text")
    expect(container.textContent).toContain("Password shown")
    expect(container.querySelector(".od-auth-reveal")?.getAttribute("aria-label")).toBe(
      "Hide password"
    )
    expect(container.querySelector(".od-auth-reveal")?.getAttribute("aria-pressed")).toBe("true")
  })

  it("stays out of the tab order, so the spec's field -> primary sequence holds", () => {
    mount(<AuthPasswordField label="Password" onChange={() => {}} value="" />)
    expect(container.querySelector(".od-auth-reveal")?.getAttribute("tabindex")).toBe("-1")
  })
})

describe("field errors", () => {
  it("renders one line under the field and points the input at it", () => {
    mount(
      <AuthPasswordField
        error="That password is too short."
        label="Password"
        onChange={() => {}}
        value="a"
      />
    )

    const input = container.querySelector("input") as HTMLInputElement
    expect(input.getAttribute("aria-invalid")).toBe("true")

    const describedBy = input.getAttribute("aria-describedby")
    expect(describedBy).toBeTruthy()

    const line = container.querySelector(`#${describedBy}`)
    expect(line?.textContent).toBe("That password is too short.")
    expect(line?.className).toContain("od-auth-error")
  })

  it("shows the error instead of the hint rather than stacking both", () => {
    mount(
      <AuthPasswordField
        error="Wrong password."
        hint="Minimum 8 characters."
        label="Password"
        onChange={() => {}}
        value="a"
      />
    )

    expect(container.textContent).toContain("Wrong password.")
    expect(container.textContent).not.toContain("Minimum 8 characters.")
  })

  it("never renders the error as a toast or a bare border", () => {
    mount(<AuthPasswordField error="Nope." label="Password" onChange={() => {}} value="a" />)
    expect(container.querySelector(".od-auth-error")?.textContent).toBe("Nope.")
    expect(container.querySelector("[role='alertdialog']")).toBeNull()
  })
})

describe("local-only entry", () => {
  it("states the local-first promise without implying local files are at risk", () => {
    mount(<LocalOnlyRow />)

    const row = container.querySelector('[data-testid="local-only-entry"]') as HTMLAnchorElement
    expect(row).not.toBeNull()
    expect(row.textContent).toContain("Continue without an account")
    expect(row.textContent).toContain("Work locally — nothing leaves this machine.")
    expect(row.getAttribute("href")).toBe("/desk")
  })

  it("is a real link, so it is reachable by keyboard from the primary", () => {
    mount(<LocalOnlyRow />)
    const row = container.querySelector('[data-testid="local-only-entry"]') as HTMLAnchorElement
    expect(row.tagName).toBe("A")
    expect(row.getAttribute("tabindex")).toBeNull()
  })
})

describe("auth card", () => {
  it("is the single elevated surface, with the brand tile above the title", () => {
    mount(
      <AuthCard subtitle="Sub" title="Back to your desk">
        <p>body</p>
      </AuthCard>
    )

    const card = container.querySelector('[data-testid="auth-card"]') as HTMLElement
    expect(card.className).toContain("od-auth-card")
    expect(card.querySelector("h1")?.textContent).toBe("Back to your desk")
    expect(card.querySelector(".od-auth-tile")).not.toBeNull()
    expect(container.querySelectorAll(".od-auth-card")).toHaveLength(1)
  })

  it("accepts a replacement tile, so reset success is a state of the same card", () => {
    mount(
      <AuthCard
        tile={<span className="od-auth-success-tile" data-testid="success-tile" />}
        title="Check your email"
      >
        <p>body</p>
      </AuthCard>
    )

    const card = container.querySelector('[data-testid="auth-card"]') as HTMLElement
    expect(card.querySelector('[data-testid="success-tile"]')).not.toBeNull()
    expect(card.querySelector(".od-auth-tile")).toBeNull()
    expect(card.className).toContain("od-auth-card")
  })
})
