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
      <CorrectionsPanel
        suggestions={[]}
        markdown=""
        correctionsEnabled={true}
        showCorrections={true}
        onAcceptSuggestion={() => {}}
        onRejectSuggestion={() => {}}
        onAcceptAll={() => {}}
        onRejectAll={() => {}}
        onCorrectionsEnabledChange={onCorrectionsEnabledChange}
        onShowCorrectionsChange={onShowCorrectionsChange}
        onClose={() => {}}
      />,
    )

    expect(html).toContain("Correcciones activas")
    expect(html).toContain("Mostrar correcciones")
  })

  it("renders with toggles disabled when props are false", () => {
    const html = renderToString(
      <CorrectionsPanel
        suggestions={[]}
        markdown=""
        correctionsEnabled={false}
        showCorrections={false}
        onAcceptSuggestion={() => {}}
        onRejectSuggestion={() => {}}
        onAcceptAll={() => {}}
        onRejectAll={() => {}}
        onCorrectionsEnabledChange={() => {}}
        onShowCorrectionsChange={() => {}}
        onClose={() => {}}
      />,
    )

    expect(html).toContain("Correcciones activas")
    expect(html).toContain("Mostrar correcciones")
  })
})
