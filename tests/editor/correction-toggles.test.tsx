/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest"
import React from "react"
import { renderToString } from "react-dom/server"
import { CorrectionsPanel } from "@/components/editor/panels/corrections-panel"

describe("CorrectionsPanel analysis trigger", () => {
  it("renders with analyze button and showCorrections toggle", () => {
    const onAnalyze = vi.fn()
    const onShowCorrectionsChange = vi.fn()

    const html = renderToString(
      React.createElement(CorrectionsPanel, {
        suggestions: [],
        markdown: "",
        showCorrections: true,
        onAcceptSuggestion: () => {},
        onRejectSuggestion: () => {},
        onLearnWord: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        learnedWords: [],
        learnedWordsLoading: false,
        onRemoveLearnedWord: () => {},
        onAnalyze,
        onShowCorrectionsChange,
        onClose: () => {},
      }),
    )

    expect(html).toContain("Analyze writing and spelling")
    expect(html).toContain("Show corrections")
  })

  it("renders the cancellable analysis action with busy semantics while running", () => {
    const html = renderToString(
      React.createElement(CorrectionsPanel, {
        suggestions: [],
        markdown: "",
        showCorrections: false,
        analysisStatus: { runState: "running", progress: { completedBlocks: 1, totalBlocks: 3 } },
        onAcceptSuggestion: () => {},
        onRejectSuggestion: () => {},
        onLearnWord: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        learnedWords: [],
        learnedWordsLoading: false,
        onRemoveLearnedWord: () => {},
        onAnalyze: () => {},
        onShowCorrectionsChange: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain("Cancel")
    expect(html).toContain("Show corrections")
  })

  it("exposes a recoverable partial state with an explicit retry action", () => {
    const html = renderToString(
      React.createElement(CorrectionsPanel, {
        suggestions: [],
        markdown: "",
        showCorrections: true,
        analysisStatus: { runState: "partial", progress: { completedBlocks: 4, totalBlocks: 6 } },
        onAcceptSuggestion: () => {},
        onRejectSuggestion: () => {},
        onLearnWord: () => {},
        onAcceptAll: () => {},
        onRejectAll: () => {},
        learnedWords: [],
        learnedWordsLoading: false,
        onRemoveLearnedWord: () => {},
        onAnalyze: () => {},
        onRetryFailed: () => {},
        onShowCorrectionsChange: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain("Retry")
    expect(html).toContain("Some correction packages failed")
    expect(html).toContain('role="status"')
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
        onAnalyze: () => {},
        onShowCorrectionsChange: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain("Learn word")
    expect(html).toContain("Learned words")
    expect(html).toContain("odessay")
  })
})
