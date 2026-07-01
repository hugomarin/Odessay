import { notFound } from "next/navigation"
import { OrthographyHarnessClient } from "@/app/perf/orthography-harness/orthography-harness-client"

export default function OrthographyHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  return <OrthographyHarnessClient />
}
