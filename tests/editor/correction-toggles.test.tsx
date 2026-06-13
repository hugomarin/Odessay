/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest"
import React from "react"
import { renderToString } from "react-dom/server"
import { CorrectionsPanel } from "@/components/editor/panels/corrections-panel"

describe("CorrectionsPanel toggles", () => {
  it("renders with correctionsEnabled and showCorrections toggles", () => {
    const onCorrectionsEnabledChange = vi.fn()
    const onShowCorrectionsChange = vi.fn()

    const html = renderToString(
      React.createElement(CorrectionsPanel, {
        suggestions: [],
        markdown: "",
        correctionsEnabled: true,
        showCorrections: true,
        onAcceptSuggestion: () => {},
        onRejectSuggestion: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        onCorrectionsEnabledChange,
        onShowCorrectionsChange,
        onClose: () => {},
      }),
    )

    expect(html).toContain("Active corrections")
    expect(html).toContain("Show corrections")
  })

  it("renders with toggles disabled when props are false", () => {
    const html = renderToString(
      React.createElement(CorrectionsPanel, {
        suggestions: [],
        markdown: "",
        correctionsEnabled: false,
        showCorrections: false,
        onAcceptSuggestion: () => {},
        onRejectSuggestion: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        onCorrectionsEnabledChange: () => {},
        onShowCorrectionsChange: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain("Active corrections")
    expect(html).toContain("Show corrections")
  })
})
