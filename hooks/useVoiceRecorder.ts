"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type VoiceRecorderState = "idle" | "requesting" | "recording" | "paused" | "stopped"

const SAMPLE_INTERVAL_MS = 100
const MAX_DURATION_SECONDS = 120
const MAX_WAVEFORM_SAMPLES = 24

type RecorderFinishMode = "stopped" | "discarded"

export function calculateWaveformRms(data: Uint8Array) {
  if (data.length === 0) return 0

  let sum = 0
  for (const value of data) {
    const centered = (value - 128) / 128
    sum += centered * centered
  }

  return Math.min(1, Math.sqrt(sum / data.length))
}

export function appendWaveformSample(history: number[], sample: number, limit = MAX_WAVEFORM_SAMPLES) {
  const nextSample = Math.max(0, Math.min(1, sample))
  const nextHistory = history.length >= limit ? history.slice(history.length - limit + 1) : history.slice()
  nextHistory.push(nextSample)
  return nextHistory
}

const PREFERRED_RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
]

function isPermissionDeniedError(error: unknown) {
  return error instanceof DOMException && error.name === "NotAllowedError"
}

export function getPreferredRecorderMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return ""
  }

  return (
    PREFERRED_RECORDER_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ??
    ""
  )
}

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>("idle")
  const [blob, setBlob] = useState<Blob | null>(null)
  const [waveformData, setWaveformData] = useState<number[]>([])
  const [duration, setDuration] = useState(0)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [isSupported, setIsSupported] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const sampleTimerRef = useRef<number | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const startedAtRef = useRef<number | null>(null)
  const finishModeRef = useRef<RecorderFinishMode>("stopped")
  const mountedRef = useRef(true)

  const clearTimers = useCallback(() => {
    if (sampleTimerRef.current !== null) {
      window.clearInterval(sampleTimerRef.current)
      sampleTimerRef.current = null
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
  }, [])

  const releaseMediaResources = useCallback(() => {
    clearTimers()
    startedAtRef.current = null

    analyserRef.current?.disconnect()
    analyserRef.current = null

    const audioContext = audioContextRef.current
    audioContextRef.current = null
    if (audioContext) {
      void audioContext.close().catch(() => undefined)
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
  }, [clearTimers])

  const reset = useCallback(() => {
    finishModeRef.current = "discarded"

    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
    } else {
      releaseMediaResources()
    }

    mediaRecorderRef.current = null
    chunksRef.current = []

    if (mountedRef.current) {
      setState("idle")
      setBlob(null)
      setWaveformData([])
      setDuration(0)
      setErrorMessage(null)
    }
  }, [releaseMediaResources])

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || (recorder.state !== "recording" && recorder.state !== "paused")) return

    finishModeRef.current = "stopped"
    clearTimers()
    recorder.stop()
  }, [clearTimers])

  const pause = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== "recording") return

    recorder.pause()
    setState("paused")
  }, [])

  const resume = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== "paused") return

    recorder.resume()
    setState("recording")
  }, [])

  const start = useCallback(async () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return

    const supportsRecording = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    if (!supportsRecording) {
      setIsSupported(false)
      return
    }

    setIsSupported(true)
    setPermissionDenied(false)
    setErrorMessage(null)
    setState("requesting")
    setBlob(null)
    setWaveformData([])
    setDuration(0)
    chunksRef.current = []
    finishModeRef.current = "stopped"

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current) {
        for (const track of stream.getTracks()) track.stop()
        return
      }

      const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) {
        setIsSupported(false)
        setState("idle")
        setErrorMessage("Audio capture is not available in this runtime.")
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }

      const audioContext = new AudioContextCtor()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.85

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      const preferredMimeType = getPreferredRecorderMimeType()
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream)

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      mediaRecorderRef.current = recorder
      streamRef.current = stream
      startedAtRef.current = Date.now()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const elapsedSeconds =
          startedAtRef.current === null ? 0 : Math.min(MAX_DURATION_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1000))
        const nextBlob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }) : null
        const finishMode = finishModeRef.current

        mediaRecorderRef.current = null
        chunksRef.current = []
        releaseMediaResources()

        if (!mountedRef.current) return

        if (finishMode === "stopped") {
          setBlob(nextBlob)
          setState("stopped")
          setDuration(elapsedSeconds)
          return
        }

        setBlob(null)
        setWaveformData([])
        setDuration(0)
        setState("idle")
      }

      recorder.onpause = () => {
        if (mountedRef.current) {
          setState("paused")
        }
      }

      recorder.onresume = () => {
        if (mountedRef.current) {
          setState("recording")
        }
      }

      recorder.onerror = (event) => {
        releaseMediaResources()
        mediaRecorderRef.current = null
        chunksRef.current = []

        if (!mountedRef.current) {
          return
        }

        setState("idle")
        setBlob(null)
        setWaveformData([])
        setDuration(0)
        setErrorMessage(
          event.error?.message ?? "Recording failed in this desktop runtime. Try again.",
        )
      }

      recorder.start()
      setState("recording")

      sampleTimerRef.current = window.setInterval(() => {
        const analyserNode = analyserRef.current
        const startedAt = startedAtRef.current
        if (!analyserNode || startedAt === null || !mountedRef.current) return

        const samples = new Uint8Array(analyserNode.fftSize)
        analyserNode.getByteTimeDomainData(samples)

        setWaveformData((current) => appendWaveformSample(current, calculateWaveformRms(samples)))
        setDuration(Math.min(MAX_DURATION_SECONDS, Math.floor((Date.now() - startedAt) / 1000)))
      }, SAMPLE_INTERVAL_MS)

      stopTimerRef.current = window.setTimeout(() => {
        stop()
      }, MAX_DURATION_SECONDS * 1000)
    } catch (error) {
      releaseMediaResources()
      chunksRef.current = []
      setState("idle")
      setBlob(null)
      setWaveformData([])
      setDuration(0)

      if (isPermissionDeniedError(error)) {
        setPermissionDenied(true)
        setErrorMessage("Microphone permission was denied.")
        return
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Audio capture could not start in this runtime.",
      )
    }
  }, [releaseMediaResources, stop])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      releaseMediaResources()
    }
  }, [releaseMediaResources])

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return

    let cancelled = false
    let permissionStatus: PermissionStatus | null = null

    void navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (cancelled) return

        permissionStatus = status
        setPermissionDenied(status.state === "denied")
        status.onchange = () => {
          if (!cancelled) {
            setPermissionDenied(status.state === "denied")
          }
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      if (permissionStatus) permissionStatus.onchange = null
    }
  }, [])

  return {
    state,
    start,
    stop,
    pause,
    resume,
    reset,
    blob,
    waveformData,
    duration,
    permissionDenied,
    isSupported,
    errorMessage,
  }
}
