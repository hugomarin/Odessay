import { Avatar, AvatarFallback } from "@/components/ui/avatar"

type PublicAuthorProfile = {
  displayName: string
  username: string
  bio: string | null
}

function buildInitials(displayName: string, username: string): string {
  const source = displayName.trim().length > 0 ? displayName : username
  const parts = source.split(/\s+/).filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function truncateBio(bio: string | null): string | null {
  if (!bio) return null
  const trimmed = bio.trim()
  if (!trimmed) return null
  if (trimmed.length <= 280) return trimmed
  return `${trimmed.slice(0, 277)}...`
}

export function AuthorHeader({ profile }: { profile: PublicAuthorProfile }) {
  const initials = buildInitials(profile.displayName, profile.username)
  const bio = truncateBio(profile.bio)

  return (
    <div
      id="author-header"
      data-section="author-header"
      data-testid="author-header"
      className="AuthorHeader flex flex-col items-center gap-5 text-center"
    >
      <Avatar className="h-16 w-16 border-[0.5px] border-border">
        <AvatarFallback className="bg-ink text-lg font-semibold text-bg">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col items-center gap-1">
        <h1 className="font-lora text-[22px] font-medium text-ink">{profile.displayName}</h1>
        <p className="text-[14px] text-ink-3">@{profile.username}</p>
      </div>

      {bio ? (
        <p className="max-w-[560px] text-[15px] leading-relaxed text-ink-2">{bio}</p>
      ) : null}
    </div>
  )
}
