import { Node, mergeAttributes } from "@tiptap/core"

const FRONTMATTER_OPEN = "---\n"
const FRONTMATTER_CLOSE = "\n---"

const decodeRaw = (value: string | null) => {
  if (!value) return ""

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const frontmatterToMarkdown = (raw: string) => `${FRONTMATTER_OPEN}${raw}${FRONTMATTER_CLOSE}`

type FrontmatterRow = { key: string; value: string }

type MarkdownBlockToken = {
  content: string
  map: [number, number] | null
  block: boolean
}

type MarkdownBlockState = {
  src: string
  bMarks: number[]
  eMarks: number[]
  line: number
  push: (type: string, tag: string, nesting: number) => MarkdownBlockToken
}

const readRows = (raw: string): FrontmatterRow[] =>
  raw.split("\n").flatMap((line) => {
    const match = /^([^:#][^:]*):(?:[ \t]*(.*))?$/.exec(line)
    return match ? [{ key: match[1].trim(), value: match[2] ?? "" }] : []
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setupMarkdownItRule(md: any) {
  md.block.ruler.before("hr", "foreign_frontmatter", (state: MarkdownBlockState, startLine: number, endLine: number, silent: boolean) => {
    if (startLine !== 0 || state.src.slice(state.bMarks[startLine], state.eMarks[startLine]).trim() !== "---") {
      return false
    }

    let closeLine = -1
    for (let line = startLine + 1; line < endLine; line += 1) {
      if (state.src.slice(state.bMarks[line], state.eMarks[line]).trim() === "---") {
        closeLine = line
        break
      }
    }

    if (closeLine === -1) return false
    if (silent) return true

    const raw = state.src.slice(state.bMarks[startLine + 1], state.bMarks[closeLine]).replace(/\n$/, "")
    const token = state.push("html_block", "", 0)
    token.content = `<odessay-frontmatter data-raw="${encodeURIComponent(raw)}"></odessay-frontmatter>\n`
    token.map = [startLine, closeLine + 1]
    token.block = true
    state.line = closeLine + 1
    return true
  })
}

/**
 * Foreign document front-matter is content, not Odessay metadata. The node is
 * deliberately read-only in Rich mode so its raw YAML can round-trip intact.
 */
export const FrontmatterNode = Node.create({
  name: "frontmatter",

  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: {
        default: "",
        parseHTML: (element) => decodeRaw(element.getAttribute("data-raw")),
        renderHTML: (attrs) => ({ "data-raw": encodeURIComponent(String(attrs.raw ?? "")) }),
      },
    }
  },

  parseHTML() {
    return [
      { tag: "odessay-frontmatter" },
      { tag: 'pre[data-frontmatter="true"]' },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "pre",
      mergeAttributes(HTMLAttributes, { "data-frontmatter": "true" }),
      frontmatterToMarkdown(String(node.attrs.raw ?? "")),
    ]
  },

  renderText({ node }) {
    return frontmatterToMarkdown(String(node.attrs.raw ?? ""))
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("section")
      dom.className = "odessay-frontmatter"
      dom.contentEditable = "false"
      dom.setAttribute("aria-label", "Document front matter")

      const rows = readRows(String(node.attrs.raw ?? ""))
      if (rows.length === 0) {
        const raw = document.createElement("pre")
        raw.className = "odessay-frontmatter-raw"
        raw.textContent = String(node.attrs.raw ?? "")
        dom.appendChild(raw)
        return { dom }
      }

      const list = document.createElement("dl")
      list.className = "odessay-frontmatter-list"
      for (const row of rows) {
        const key = document.createElement("dt")
        key.textContent = row.key
        const value = document.createElement("dd")
        value.textContent = row.value
        list.append(key, value)
      }
      dom.appendChild(list)
      return { dom }
    }
  },

  addStorage() {
    return {
      markdown: {
        parse: { setup: setupMarkdownItRule },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(frontmatterToMarkdown(String(node.attrs.raw ?? "")))
          state.closeBlock(node)
        },
      },
    }
  },
})
