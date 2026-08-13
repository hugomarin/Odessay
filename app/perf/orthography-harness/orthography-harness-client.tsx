"use client"

import { useEffect, useState } from "react"
import { EditorShell } from "@/components/editor/editor-shell"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import {
  createOrthographyRegressionCorrectionBlocks,
  createOrthographyRegressionWriting,
} from "@/lib/testing/orthography-regression-writing"
import {
  ORTHOGRAPHY_REGRESSION_WRITING_ID,
} from "@/lib/testing/orthography-regression-fixture"

type OrthographyHarnessWindow = Window & typeof globalThis & {
  __ODE_ORTHOGRAPHY_HARNESS__?: {
    readWriting: () => ReturnType<typeof localDB.writings.get>
    readCorrectionBlocks: () => ReturnType<typeof localDB.correctionBlocks.getByWriting>
    clearCorrectionBlocks: () => Promise<void>
  }
}

const stripResetQueryParam = () => {
  if (typeof window === "undefined") {
    return
  }

  const url = new URL(window.location.href)
  if (url.searchParams.get("reset") !== "1") {
    return
  }

  url.searchParams.delete("reset")
  const nextQuery = url.searchParams.toString()
  const nextHref = `${url.pathname}${nextQuery ? `?${nextQuery}` : ""}${url.hash}`
  window.history.replaceState(null, "", nextHref)
}

export function OrthographyHarnessClient() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    const setup = async () => {
      const shouldReset =
        typeof window !== "undefined" && new URL(window.location.href).searchParams.get("reset") === "1"

      setLocalDBScope(undefined)

      const existingWriting = await localDB.writings.get(ORTHOGRAPHY_REGRESSION_WRITING_ID)

      if (shouldReset || !existingWriting) {
        const existingBlocks = await localDB.correctionBlocks.getByWriting(ORTHOGRAPHY_REGRESSION_WRITING_ID)
        if (existingBlocks.length > 0) {
          await localDB.correctionBlocks.deleteMany(existingBlocks.map((block) => block.id))
        }

        await localDB.syncQueue.deleteForEntity("writing", ORTHOGRAPHY_REGRESSION_WRITING_ID)
        await localDB.writings.save(createOrthographyRegressionWriting())
        await localDB.correctionBlocks.saveMany(createOrthographyRegressionCorrectionBlocks())
        stripResetQueryParam()
      }

      if (!cancelled) {
        setReady(true)
      }
    }

    void setup()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const harnessWindow = window as OrthographyHarnessWindow
    harnessWindow.__ODE_ORTHOGRAPHY_HARNESS__ = {
      readWriting: () => localDB.writings.get(ORTHOGRAPHY_REGRESSION_WRITING_ID),
      readCorrectionBlocks: () => localDB.correctionBlocks.getByWriting(ORTHOGRAPHY_REGRESSION_WRITING_ID),
      clearCorrectionBlocks: async () => {
        const blocks = await localDB.correctionBlocks.getByWriting(ORTHOGRAPHY_REGRESSION_WRITING_ID)
        await localDB.correctionBlocks.deleteMany(blocks.map((block) => block.id))
      },
    }

    return () => {
      delete harnessWindow.__ODE_ORTHOGRAPHY_HARNESS__
    }
  }, [])

  if (!ready) {
    return (
      <div
        data-testid="orthography-harness-loading"
        className="flex min-h-screen items-center justify-center text-[13px] text-ink-4"
      >
        Preparing orthography harness…
      </div>
    )
  }

  return <EditorShell writingId={ORTHOGRAPHY_REGRESSION_WRITING_ID} />
}
