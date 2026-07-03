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
        onLearnWord: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        learnedWords: [],
        learnedWordsLoading: false,
        onRemoveLearnedWord: () => {},
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
        onLearnWord: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        learnedWords: [],
        learnedWordsLoading: false,
        onRemoveLearnedWord: () => {},
        onCorrectionsEnabledChange: () => {},
        onShowCorrectionsChange: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain("Active corrections")
    expect(html).toContain("Show corrections")
  })

  it("shows the learn word action for spelling suggestions and lists learned words", () => {
    const html = renderToString(
      React.createElement(CorrectionsPanel, {
        suggestions: [
          {
            id: "s1",
            kind: "spelling",
            mechanical_type: "spelling",
            title: "Fix spelling",
            reason: "",
            original_text: "Odessay",
            replacement_text: "Odyssey",
            status: "pending",
          },
        ],
        markdown: "Odessay",
        correctionsEnabled: true,
        showCorrections: true,
        onAcceptSuggestion: () => {},
        onRejectSuggestion: () => {},
        onLearnWord: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        learnedWords: [
          {
            id: "lw-1",
            word: "odessay",
            language: "unknown",
            createdAt: "2026-07-03T00:00:00.000Z",
          },
        ],
        learnedWordsLoading: false,
        onRemoveLearnedWord: () => {},
        onCorrectionsEnabledChange: () => {},
        onShowCorrectionsChange: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain("Learn word")
    expect(html).toContain("Learned words")
    expect(html).toContain("odessay")
  })
})
