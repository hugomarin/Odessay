import { describe, expect, it } from "vitest"

import { createHydrationGenerationOwner } from "@/lib/editor/hydration-generation"

describe("ODE-464 — editor hydration generation ownership", () => {
  it("allows only the current generation to run effects", () => {
    const owner = createHydrationGenerationOwner()
    const generation = owner.start("doc-a")

    expect(generation.isCurrent()).toBe(true)
    expect(generation.run(() => "applied")).toEqual({
      status: "current",
      value: "applied",
    })
  })

  it("starting B invalidates A, including when both target the same writing", () => {
    const owner = createHydrationGenerationOwner()
    const firstA = owner.start("doc-a")
    const secondA = owner.start("doc-a")

    expect(firstA.isCurrent()).toBe(false)
    expect(firstA.run(() => "stale effect")).toEqual({ status: "stale" })
    expect(secondA.isCurrent()).toBe(true)

    const generationB = owner.start("doc-b")
    expect(secondA.isCurrent()).toBe(false)
    expect(generationB.isCurrent()).toBe(true)
  })

  it("does not let stale or repeated cleanup cancel a newer generation", () => {
    const owner = createHydrationGenerationOwner()
    const generationA = owner.start("doc-a")
    const generationB = owner.start("doc-b")

    owner.cancel(generationA)
    owner.cancel(generationA)
    expect(generationB.isCurrent()).toBe(true)

    owner.cancel(generationB)
    owner.cancel(generationB)
    expect(generationB.isCurrent()).toBe(false)
  })

  it("discards an async A result when B starts before A resolves", async () => {
    const owner = createHydrationGenerationOwner()
    const generationA = owner.start("doc-a")
    let releaseA!: (value: string) => void

    const resultA = generationA.runAsync(
      () =>
        new Promise<string>((resolve) => {
          releaseA = resolve
        }),
    )

    const generationB = owner.start("doc-b")
    releaseA("late A")

    await expect(resultA).resolves.toEqual({ status: "stale" })
    expect(generationB.run(() => "B applied")).toEqual({
      status: "current",
      value: "B applied",
    })
  })

  it("does not start async work for an already stale generation", async () => {
    const owner = createHydrationGenerationOwner()
    const generationA = owner.start("doc-a")
    owner.start("doc-b")
    let started = false

    await expect(
      generationA.runAsync(async () => {
        started = true
        return "unexpected"
      }),
    ).resolves.toEqual({ status: "stale" })
    expect(started).toBe(false)
  })
})
