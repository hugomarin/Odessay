"use client"

import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { hasEnoughTitleSuggestionContent } from "@/lib/ai/title-suggestions"
import { webAIService } from "@/lib/services/web-ai-service"

type RenameWritingModalProps = {
  open: boolean
  title: string
  bodyText?: string
  writingId?: string
  onOpenChange: (open: boolean) => void
  onConfirm: (title: string) => void
}

export function RenameWritingModal({
  open,
  title,
  bodyText = "",
  writingId,
  onOpenChange,
  onConfirm,
}: RenameWritingModalProps) {
  const [nextTitle, setNextTitle] = useState(title)
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [isSuggesting, setIsSuggesting] = useState(false)
  const canSuggestTitle = hasEnoughTitleSuggestionContent(bodyText)

  useEffect(() => {
    if (open) {
      setNextTitle(title)
      setSuggestedTitle(null)
      setSuggestionError(null)
      setIsSuggesting(false)
    }
  }, [open, title])

  const requestSuggestion = async () => {
    if (!canSuggestTitle || isSuggesting) {
      return
    }

    setIsSuggesting(true)
    setSuggestionError(null)

    try {
      const result = await webAIService.suggestTitle({
        currentTitle: nextTitle,
        bodyText,
        writingId,
      })

      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Could not suggest a title.")
      }

      setSuggestedTitle(result.data.title)
    } catch (error) {
      setSuggestionError(error instanceof Error ? error.message : "Could not suggest a title.")
    } finally {
      setIsSuggesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Rename writing</DialogTitle>
          <DialogDescription>Update the title shown in the editor, Desk, and Collections.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            onConfirm(nextTitle.trim() || "Untitled writing")
            onOpenChange(false)
          }}
        >
          <label className="block space-y-2">
            <span className="text-[12px] font-medium text-ink-3">Title</span>
            <Input
              autoFocus
              value={nextTitle}
              onChange={(event) => setNextTitle(event.target.value)}
              placeholder="Untitled writing"
              maxLength={160}
            />
          </label>

          <div className="rounded-[10px] border-[0.5px] border-border bg-bg p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink-2">AI suggestion</p>
                <p className="mt-1 text-[11px] leading-4 text-ink-4">
                  {canSuggestTitle
                    ? "Ask AI for one title suggestion, then accept only if it fits."
                    : "Write a little more before asking AI for a title."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSuggestTitle || isSuggesting}
                onClick={requestSuggestion}
                className="h-8 shrink-0 gap-2 px-3 text-[12px]"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
                {isSuggesting ? "Suggesting" : "Suggest"}
              </Button>
            </div>

            {suggestedTitle ? (
              <div className="mt-3 rounded-[8px] border-[0.5px] border-[hsl(22_40%_84%)] bg-[hsl(22_55%_97%)] p-3">
                <p className="font-lora text-[15px] font-medium text-ink">{suggestedTitle}</p>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setNextTitle(suggestedTitle)}
                    className="h-8 px-3 text-[12px]"
                  >
                    Use suggestion
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSuggestedTitle(null)}
                    className="h-8 px-3 text-[12px]"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : null}

            {suggestionError ? <p className="mt-3 text-[11px] text-destructive">{suggestionError}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save title</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
