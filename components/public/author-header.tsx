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
      className="AuthorHeader flex flex-col items-center gap-4 text-center sm:gap-5"
    >
      <Avatar data-testid="author-avatar" className="h-12 w-12 border-[0.5px] border-border sm:h-16 sm:w-16">
        <AvatarFallback className="bg-ink text-lg font-semibold text-bg">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col items-center gap-1">
        <h1 className="font-lora text-[18px] font-medium text-ink sm:text-[22px]">{profile.displayName}</h1>
        <p className="text-[13px] text-ink-3 sm:text-[14px]">@{profile.username}</p>
      </div>

      {bio ? (
        <p className="max-w-[560px] text-[14px] leading-relaxed text-ink-2 sm:text-[15px]">{bio}</p>
      ) : null}
    </div>
  )
}
