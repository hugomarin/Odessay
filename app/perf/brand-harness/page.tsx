import {
  ArtifactLockup,
  ArtifactMark,
  ArtifactMarkTile
} from "@/components/brand/artifact-mark"

/**
 * Evidence surface for ODE-424. Renders the real mark component at the sizes
 * `docs/design/brand.md` specifies, on light and on dark, so the two-blade
 * degradation under 20px is visible rather than asserted.
 */

const SIZES = [16, 20, 22, 24, 26, 34]

function Row({ palette, label }: { palette: "app" | "onDark"; label: string }) {
  return (
    <div>
      <p style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.6 }}>
        {label}
      </p>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 28, marginTop: 12 }}>
        {SIZES.map((size) => (
          <div key={size} style={{ textAlign: "center" }}>
            <ArtifactMark size={size} palette={palette} />
            <p style={{ fontSize: 10, marginTop: 8, opacity: 0.55 }}>{size}px</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function BrandHarnessPage() {
  return (
    <main style={{ fontFamily: "var(--font-dm-sans), system-ui, sans-serif" }}>
      <section style={{ background: "#F7F5F2", color: "#1E1915", padding: 32 }}>
        <Row palette="app" label="Mark on light — app palette" />

        <div style={{ display: "flex", alignItems: "flex-end", gap: 32, marginTop: 32 }}>
          <div>
            <p style={{ fontSize: 10, opacity: 0.55, marginBottom: 8 }}>Landing / accent, 26px</p>
            <ArtifactMark size={26} palette="landing" />
          </div>
          <div>
            <p style={{ fontSize: 10, opacity: 0.55, marginBottom: 8 }}>Auth tile — 24 in 44</p>
            <ArtifactMarkTile tile={44} radius={13} />
          </div>
          <div>
            <p style={{ fontSize: 10, opacity: 0.55, marginBottom: 8 }}>Splash tile — 34 in 64</p>
            <ArtifactMarkTile tile={64} radius={18} shadow="0 12px 34px rgba(35,24,15,.22)" />
          </div>
          <div>
            <p style={{ fontSize: 10, opacity: 0.55, marginBottom: 8 }}>Lockup — Geist 500</p>
            <ArtifactLockup markSize={26} fontSize={17} />
          </div>
        </div>
      </section>

      <section style={{ background: "#1E1915", color: "#F5F3EF", padding: 32 }}>
        <Row palette="onDark" label="Mark on dark — on-dark palette" />
      </section>
    </main>
  )
}
