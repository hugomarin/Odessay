import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import BulletList from "@tiptap/extension-bullet-list"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import ListItem from "@tiptap/extension-list-item"
import OrderedList from "@tiptap/extension-ordered-list"
import Paragraph from "@tiptap/extension-paragraph"
import Strike from "@tiptap/extension-strike"
import Text from "@tiptap/extension-text"
import type { JSONContent } from "@tiptap/core"
import { generateHTML } from "@tiptap/html"
import { FootnoteExtension } from "@/lib/editor/footnote-extension"

const READING_EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Strike,
  Highlight,
  Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  Code,
  CodeBlock,
  FootnoteExtension,
]

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? "" : "s"} ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) === 1 ? "" : "s"} ago`
  return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) === 1 ? "" : "s"} ago`
}

// Deterministic avatar background from display name
function getAvatarHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}

type ReadingContentProps = {
  title: string | null
  bodyJson: JSONContent | null
  bodyText: string
  author: {
    displayName: string
    username: string
  } | null
  updatedAt: string
  bodyRef?: React.RefObject<HTMLDivElement | null>
}

export function ReadingContent({ title, bodyJson, bodyText, author, updatedAt, bodyRef }: ReadingContentProps) {
  let bodyHtml: string
  if (bodyJson && typeof bodyJson === "object" && !Array.isArray(bodyJson)) {
    try {
      bodyHtml = generateHTML(bodyJson, READING_EXTENSIONS)
    } catch {
      bodyHtml = `<p>${bodyText.replace(/</g, "&lt;")}</p>`
    }
  } else {
    bodyHtml = `<p>${bodyText.replace(/</g, "&lt;")}</p>`
  }

  const displayName = author?.displayName ?? author?.username ?? "Odessay author"
  const initials = getInitials(displayName)
  const hue = getAvatarHue(displayName)
  const relativeDate = formatRelativeDate(updatedAt)

  return (
    <div
      id="reading-text"
      data-section="reading-text"
      data-testid="reading-text"
      className="ReadingText h-full overflow-y-auto"
    >
      <div className="mx-auto max-w-[660px] px-10 pb-20 pt-14">
        {/* Author block */}
        <div className="mb-11 flex items-center gap-3 border-b-[0.5px] border-border pb-6">
          <div
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ backgroundColor: `hsl(${hue}, 30%, 45%)` }}
            aria-label={displayName}
          >
            {initials}
          </div>
          <div>
            <p className="text-[14px] font-medium text-ink-3">{displayName}</p>
            <p className="text-[12px] text-ink-4">{relativeDate}</p>
          </div>
        </div>

        <article ref={bodyRef}>
          {/* Title */}
          <h1 className="mb-8 font-lora text-[30px] font-medium leading-[1.2] tracking-[-0.01em] text-ink">
            {title ?? "Untitled"}
          </h1>

          {/* Body */}
          <div
            id="reading-body"
            data-section="reading-body"
            data-testid="reading-body"
            className="prose-odessay"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        </article>
      </div>
    </div>
  )
}
