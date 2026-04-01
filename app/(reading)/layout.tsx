// Reading layout — no sidebar, no editor toolbar.
// Shared by authenticated reading routes (/shared/[id]) and future public routes (/{username}/{slug}).
export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
