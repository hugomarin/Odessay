import { ArtifactMark } from "@/components/brand/artifact-mark"

type AppSplashProps = {
  /**
   * Shown under the progress bar. The prototype uses "v0.4 · local-first" at
   * rest and "opening your desk…" while work is in flight.
   */
  caption?: string
  /**
   * Set when boot failed. Replaces the crawling bar with something the user can
   * act on — a splash that keeps crawling forever is the failure mode this
   * guards against.
   */
  error?: string | null
  onRetry?: () => void
}

/**
 * The desktop launch screen — `docs/design/views/auth-splash.md`.
 *
 * It has no minimum duration on purpose: it renders while boot is resolving and
 * disappears the moment it is done. Nothing here delays the transition.
 */
export function AppSplash({ caption = "v0.4 · local-first", error = null, onRetry }: AppSplashProps) {
  return (
    <div className="od-splash-stage" data-testid="app-splash" role="status" aria-live="polite">
      <div className="od-splash-group">
        <span className="od-splash-tile">
          <ArtifactMark size={34} palette="onDark" decorative />
        </span>

        <p className="od-splash-wordmark">Artifact Studio</p>

        {error ? (
          <>
            <p className="od-splash-error">{error}</p>
            {onRetry ? (
              <button className="od-auth-primary" onClick={onRetry} style={{ width: 140 }} type="button">
                Try again
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="od-splash-track">
              <span className="od-splash-thumb" />
            </div>
            <p className="od-splash-caption">{caption}</p>
          </>
        )}
      </div>
    </div>
  )
}
