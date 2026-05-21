/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import WritePage from "@/app/(app)/write/page"

describe("WritePage forceNewWriting prop", () => {
  it("resolves forceNewWriting=true when ?new=1", async () => {
    const props = {
      searchParams: Promise.resolve({ new: "1" }),
    }
    const element = await WritePage(props)
    expect(element.props.forceNewWriting).toBe(true)
    expect(element.key).toBe("write-new")
  })

  it("resolves forceNewWriting=false when new is absent", async () => {
    const props = {
      searchParams: Promise.resolve({}),
    }
    const element = await WritePage(props)
    expect(element.props.forceNewWriting).toBe(false)
    expect(element.key).toBe("write-root")
  })

  it("resolves forceNewWriting=false when new is not '1'", async () => {
    const props = {
      searchParams: Promise.resolve({ new: "0" }),
    }
    const element = await WritePage(props)
    expect(element.props.forceNewWriting).toBe(false)
    expect(element.key).toBe("write-root")
  })

  it("resolves forceNewWriting=false when searchParams is undefined", async () => {
    const element = await WritePage({})
    expect(element.props.forceNewWriting).toBe(false)
    expect(element.key).toBe("write-root")
  })
})
