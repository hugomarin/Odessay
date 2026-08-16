import { RailHarnessClient } from "@/app/perf/rail-harness/rail-harness-client"

/**
 * ODE-447 — evidence harness for the app rail.
 *
 * `app/perf/ode-340-global` also mounts the rail, but it mounts it inside the
 * editor, and the editor holds the rail collapsed by design. Measuring the
 * expanded rail there records 52px and calls it 232. This harness mounts the
 * real `Sidebar` over a neutral child so the capture drives the shipped
 * component in the state it is meant to be measured in.
 */
export default function RailHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    return null
  }

  return <RailHarnessClient />
}
