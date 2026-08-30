"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { Grid2X2, Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

type GridOverlaySettings = {
  horizontalSpacing: number
  verticalSpacing: number
  majorSpacing: number
  opacity: number
  visible: boolean
}

type ViewportSize = {
  height: number
  width: number
}

const STORAGE_KEY = "odessay-design-grid-overlay"
const DEFAULT_SETTINGS: GridOverlaySettings = {
  horizontalSpacing: 10,
  verticalSpacing: 10,
  majorSpacing: 20,
  opacity: 0.16,
  visible: true,
}
const DEFAULT_VIEWPORT: ViewportSize = { width: 0, height: 0 }
const AXIS_SIZE = 28
const MINOR_LINE_WIDTH = 0.5
const MAJOR_LINE_WIDTH = 1
const AXIS_LABEL_INTERVAL = 2

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const parseSpacingValue = (value: string, fallback: number, min = 2, max = 240) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return clamp(parsed, min, max)
}

const parseOpacityValue = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return clamp(parsed, 0.04, 0.4)
}

export function DesignGridOverlay() {
  const [isLocalhost, setIsLocalhost] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(true)
  const [viewportSize, setViewportSize] = useState<ViewportSize>(DEFAULT_VIEWPORT)
  const [settings, setSettings] = useState<GridOverlaySettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const { hostname } = window.location
    setIsLocalhost(
      hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "[::1]" ||
        hostname === "::1",
    )

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<GridOverlaySettings>
        setSettings({
          horizontalSpacing: clamp(parsed.horizontalSpacing ?? DEFAULT_SETTINGS.horizontalSpacing, 2, 160),
          verticalSpacing: clamp(parsed.verticalSpacing ?? DEFAULT_SETTINGS.verticalSpacing, 2, 160),
          majorSpacing: clamp(parsed.majorSpacing ?? DEFAULT_SETTINGS.majorSpacing, 10, 240),
          opacity: clamp(parsed.opacity ?? DEFAULT_SETTINGS.opacity, 0.04, 0.4),
          visible: parsed.visible ?? DEFAULT_SETTINGS.visible,
        })
      }
    } catch {
      setSettings(DEFAULT_SETTINGS)
    } finally {
      setIsReady(true)
    }
  }, [])

  useEffect(() => {
    if (!isReady || typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [isReady, settings])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const updateViewportSize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    updateViewportSize()
    window.addEventListener("resize", updateViewportSize)

    return () => {
      window.removeEventListener("resize", updateViewportSize)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "g") {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          Boolean(target.closest('input, textarea, select, [role="textbox"], [contenteditable="true"]')))
      ) {
        return
      }

      event.preventDefault()
      setSettings((current) => ({ ...current, visible: !current.visible }))
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  const overlayStyle = useMemo(() => {
    const majorOpacity = clamp(settings.opacity * 1.9, 0.08, 0.48)

    return {
      "--grid-horizontal-spacing": `${settings.horizontalSpacing}px`,
      "--grid-vertical-spacing": `${settings.verticalSpacing}px`,
      "--grid-major-spacing": `${settings.majorSpacing}px`,
      "--grid-line-color": `hsl(var(--ink) / ${settings.opacity})`,
      "--grid-major-line-color": `hsl(var(--ink) / ${majorOpacity})`,
      backgroundImage: [
        `repeating-linear-gradient(to right, var(--grid-major-line-color) 0, var(--grid-major-line-color) ${MAJOR_LINE_WIDTH}px, transparent ${MAJOR_LINE_WIDTH}px, transparent var(--grid-major-spacing))`,
        `repeating-linear-gradient(to bottom, var(--grid-major-line-color) 0, var(--grid-major-line-color) ${MAJOR_LINE_WIDTH}px, transparent ${MAJOR_LINE_WIDTH}px, transparent var(--grid-major-spacing))`,
        `repeating-linear-gradient(to right, var(--grid-line-color) 0, var(--grid-line-color) ${MINOR_LINE_WIDTH}px, transparent ${MINOR_LINE_WIDTH}px, transparent var(--grid-vertical-spacing))`,
        `repeating-linear-gradient(to bottom, var(--grid-line-color) 0, var(--grid-line-color) ${MINOR_LINE_WIDTH}px, transparent ${MINOR_LINE_WIDTH}px, transparent var(--grid-horizontal-spacing))`,
      ].join(", "),
    } as CSSProperties
  }, [settings.horizontalSpacing, settings.majorSpacing, settings.opacity, settings.verticalSpacing])

  const axisLineStyle = useMemo(() => {
    const majorOpacity = clamp(settings.opacity * 2.2, 0.12, 0.58)

    return {
      "--axis-major-line-color": `hsl(var(--ink) / ${majorOpacity})`,
    } as CSSProperties
  }, [settings.opacity])

  const horizontalMarkers = useMemo(() => {
    if (viewportSize.width === 0) {
      return []
    }

    const markers: Array<{ position: number; label: boolean }> = []
    let index = 1
    for (let position = settings.majorSpacing; position < viewportSize.width; position += settings.majorSpacing) {
      markers.push({ position, label: index % AXIS_LABEL_INTERVAL === 0 })
      index += 1
    }
    return markers
  }, [settings.majorSpacing, viewportSize.width])

  const verticalMarkers = useMemo(() => {
    if (viewportSize.height === 0) {
      return []
    }

    const markers: Array<{ position: number; label: boolean }> = []
    let index = 1
    for (let position = settings.majorSpacing; position < viewportSize.height; position += settings.majorSpacing) {
      markers.push({ position, label: index % AXIS_LABEL_INTERVAL === 0 })
      index += 1
    }
    return markers
  }, [settings.majorSpacing, viewportSize.height])

  if (process.env.NODE_ENV === "production" || !isReady || !isLocalhost) {
    return null
  }

  const updateHorizontalSpacing = (value: string) => {
    setSettings((current) => ({
      ...current,
      horizontalSpacing: parseSpacingValue(value, current.horizontalSpacing),
    }))
  }

  const updateVerticalSpacing = (value: string) => {
    setSettings((current) => ({
      ...current,
      verticalSpacing: parseSpacingValue(value, current.verticalSpacing),
    }))
  }

  const updateMajorSpacing = (value: string) => {
    setSettings((current) => ({
      ...current,
      majorSpacing: parseSpacingValue(value, current.majorSpacing, 10, 240),
    }))
  }

  const updateOpacity = (value: string) => {
    setSettings((current) => ({
      ...current,
      opacity: parseOpacityValue(value, current.opacity),
    }))
  }

  return (
    <>
      {settings.visible ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[70]"
            style={overlayStyle}
          />

          <div
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-[72] border-b-[0.5px] border-border/30 bg-sb/44"
            style={{ ...axisLineStyle, height: AXIS_SIZE, right: 0 }}
          >
            {horizontalMarkers.map(({ position, label }) => (
              <div
                key={`x-${position}`}
                className="absolute bottom-0 top-0"
                style={{ left: position }}
              >
                <div
                  className="absolute bottom-0 top-0 w-px"
                  style={{ backgroundColor: "var(--axis-major-line-color)" }}
                />
                {label ? (
                  <span className="absolute left-1 top-1 font-sans text-[9px] font-medium text-ink-4/55">
                    {position}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-[72] border-r-[0.5px] border-border/30 bg-sb/44"
            style={{ ...axisLineStyle, bottom: 0, width: AXIS_SIZE }}
          >
            {verticalMarkers.map(({ position, label }) => (
              <div
                key={`y-${position}`}
                className="absolute left-0 right-0"
                style={{ top: position }}
              >
                <div
                  className="absolute left-0 right-0 h-px"
                  style={{ backgroundColor: "var(--axis-major-line-color)" }}
                />
                {label ? (
                  <span className="absolute left-[3px] top-1 font-sans text-[9px] font-medium text-ink-4/55">
                    {position}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-[73] flex items-center justify-center border-b-[0.5px] border-r-[0.5px] border-border/30 bg-sb/56"
            style={{ height: AXIS_SIZE, width: AXIS_SIZE }}
          >
            <Grid2X2 className="h-3.5 w-3.5 text-ink-4" strokeWidth={1.5} />
          </div>
        </>
      ) : null}

      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex max-w-[min(92vw,18rem)] justify-end">
        <Card className="pointer-events-auto w-full bg-sb/92 p-3 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border bg-muted">
                <Grid2X2 className="h-4 w-4 text-ink-2" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-lora text-[15px] text-ink">Design grid</p>
                <p className="font-sans text-[11px] text-ink-4">Press `G` to show or hide</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={settings.visible}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({ ...current, visible: checked }))
                }
                aria-label="Toggle design grid"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsPanelOpen((current) => !current)}
                aria-label={isPanelOpen ? "Collapse grid controls" : "Expand grid controls"}
              >
                {isPanelOpen ? (
                  <Minus className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <Plus className="h-4 w-4" strokeWidth={1.5} />
                )}
              </Button>
            </div>
          </div>

          {isPanelOpen ? (
            <div className="mt-3 space-y-3 border-t-[0.5px] border-border pt-3">
              <label className="block">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-4">
                    Horizontal
                  </span>
                  <span className="text-xs text-ink-3">{settings.horizontalSpacing}px</span>
                </div>
                <Input
                  type="number"
                  min={2}
                  max={160}
                  step={1}
                  value={settings.horizontalSpacing}
                  onChange={(event) => updateHorizontalSpacing(event.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-4">
                    Vertical
                  </span>
                  <span className="text-xs text-ink-3">{settings.verticalSpacing}px</span>
                </div>
                <Input
                  type="number"
                  min={2}
                  max={160}
                  step={1}
                  value={settings.verticalSpacing}
                  onChange={(event) => updateVerticalSpacing(event.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-4">
                    Reference step
                  </span>
                  <span className="text-xs text-ink-3">{settings.majorSpacing}px</span>
                </div>
                <Input
                  type="number"
                  min={10}
                  max={240}
                  step={5}
                  value={settings.majorSpacing}
                  onChange={(event) => updateMajorSpacing(event.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-4">
                    Opacity
                  </span>
                  <span className="text-xs text-ink-3">{Math.round(settings.opacity * 100)}%</span>
                </div>
                <Input
                  type="number"
                  min={0.04}
                  max={0.4}
                  step={0.01}
                  value={settings.opacity}
                  onChange={(event) => updateOpacity(event.target.value)}
                />
              </label>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
              >
                Reset grid
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  )
}
