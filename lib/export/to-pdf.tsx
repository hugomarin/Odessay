import path from "node:path"
import type { ReactNode } from "react"
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer"
import type { WritingExportBlock, WritingExportDocument, WritingExportInline } from "./writing-export"

type RenderPdfParams = {
  title: string
  bodyText?: string | null
  document: WritingExportDocument
}

const FONT_ROOT = path.resolve(process.cwd(), "public/fonts/geist-sans")
const GEIST_SANS_REGULAR = path.join(FONT_ROOT, "Geist-Regular.woff2")
const GEIST_SANS_ITALIC = path.join(FONT_ROOT, "Geist-Italic[wght].woff2")
const GEIST_SANS_BOLD = path.join(FONT_ROOT, "Geist-Bold.woff2")
const GEIST_SANS_BOLD_ITALIC = path.join(FONT_ROOT, "Geist-BoldItalic.woff2")

let fontsRegistered = false

const registerFonts = () => {
  if (fontsRegistered) {
    return
  }

  Font.register({
    family: "Geist Sans",
    src: GEIST_SANS_REGULAR,
  })

  Font.register({
    family: "Geist Sans",
    src: GEIST_SANS_ITALIC,
    fontStyle: "italic",
  })

  Font.register({
    family: "Geist Sans",
    src: GEIST_SANS_BOLD,
    fontWeight: 700,
  })

  Font.register({
    family: "Geist Sans",
    src: GEIST_SANS_BOLD_ITALIC,
    fontStyle: "italic",
    fontWeight: 700,
  })

  fontsRegistered = true
}

const createStyles = (bodyFontFamily: string) =>
  StyleSheet.create({
    page: {
      paddingHorizontal: 60,
      paddingVertical: 72,
      fontFamily: bodyFontFamily,
      fontSize: 17,
      lineHeight: 1.85,
      color: "#161310",
      backgroundColor: "#f8f3ea",
    },
    title: {
      fontFamily: "Times-Roman",
      fontSize: 26,
      lineHeight: 1.2,
      marginBottom: 24,
      color: "#161310",
    },
    paragraph: {
      marginBottom: 14,
    },
    heading1: {
      fontFamily: "Times-Bold",
      fontSize: 22,
      lineHeight: 1.25,
      marginBottom: 14,
      marginTop: 8,
    },
    heading2: {
      fontFamily: "Times-Bold",
      fontSize: 19,
      lineHeight: 1.25,
      marginBottom: 12,
      marginTop: 8,
    },
    heading3: {
      fontFamily: "Times-Bold",
      fontSize: 17,
      lineHeight: 1.25,
      marginBottom: 10,
      marginTop: 6,
    },
    blockquote: {
      marginBottom: 14,
      paddingLeft: 14,
      borderLeftWidth: 2,
      borderLeftColor: "#675d51",
    },
    blockquoteText: {
      fontFamily: bodyFontFamily,
      fontStyle: "italic",
      color: "#2f2a25",
    },
    listItem: {
      marginBottom: 8,
    },
    codeBlock: {
      fontFamily: "Courier",
      fontSize: 13,
      lineHeight: 1.5,
      backgroundColor: "#eee5d6",
      padding: 10,
      borderRadius: 6,
      marginBottom: 14,
    },
    separator: {
      marginVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: "#d8cec0",
    },
    footnoteHeading: {
      marginTop: 28,
      marginBottom: 12,
      fontFamily: "Times-Bold",
      fontSize: 16,
    },
    footnote: {
      marginBottom: 8,
      fontSize: 12.5,
      lineHeight: 1.6,
    },
    footnoteIndex: {
      fontFamily: "Times-Bold",
    },
    bold: {
      fontFamily: bodyFontFamily,
      fontWeight: 700,
    },
    italic: {
      fontFamily: bodyFontFamily,
      fontStyle: "italic",
    },
    strike: {
      textDecorationLine: "line-through",
    },
    code: {
      fontFamily: "Courier",
      fontSize: 15,
    },
    highlight: {
      backgroundColor: "#f6e39c",
    },
    link: {
      color: "#6a4d2f",
      textDecorationLine: "underline",
    },
  })

const styles = createStyles("Geist Sans")
const fallbackStyles = createStyles("Helvetica")

const renderInlineRuns = (runs: WritingExportInline[], keyPrefix: string, currentStyles = styles): ReactNode[] =>
  runs.map((run, index) => {
    const runStyles = [
      run.bold ? currentStyles.bold : null,
      run.italic ? currentStyles.italic : null,
      run.strike ? currentStyles.strike : null,
      run.code ? currentStyles.code : null,
      run.highlight ? currentStyles.highlight : null,
      run.linkHref ? currentStyles.link : null,
    ].filter((style): style is NonNullable<typeof style> => style !== null)

    return (
      <Text key={`${keyPrefix}-${index}`} style={runStyles}>
        {run.text}
      </Text>
    )
  })

const renderBlock = (block: WritingExportBlock, index: number, currentStyles = styles): ReactNode => {
  switch (block.type) {
    case "paragraph":
      return (
        <Text key={`paragraph-${index}`} style={currentStyles.paragraph}>
          {renderInlineRuns(block.inlines, `paragraph-${index}`, currentStyles)}
        </Text>
      )
    case "heading":
      return (
        <Text
          key={`heading-${index}`}
          style={block.level === 1 ? currentStyles.heading1 : block.level === 2 ? currentStyles.heading2 : currentStyles.heading3}
        >
          {renderInlineRuns(block.inlines, `heading-${index}`, currentStyles)}
        </Text>
      )
    case "blockquote":
      return (
        <View key={`blockquote-${index}`} style={currentStyles.blockquote}>
          <Text style={currentStyles.blockquoteText}>{renderInlineRuns(block.inlines, `blockquote-${index}`, currentStyles)}</Text>
        </View>
      )
    case "bulletList":
      return block.items.map((item, itemIndex) => (
        <Text key={`bullet-${index}-${itemIndex}`} style={currentStyles.listItem}>
          {"• "}
          {renderInlineRuns(item, `bullet-${index}-${itemIndex}`, currentStyles)}
        </Text>
      ))
    case "orderedList":
      return block.items.map((item, itemIndex) => (
        <Text key={`ordered-${index}-${itemIndex}`} style={currentStyles.listItem}>
          {`${itemIndex + 1}. `}
          {renderInlineRuns(item, `ordered-${index}-${itemIndex}`, currentStyles)}
        </Text>
      ))
    case "codeBlock":
      return (
        <Text key={`code-${index}`} style={currentStyles.codeBlock}>
          {block.code.trimEnd()}
        </Text>
      )
    case "separator":
      return <View key={`separator-${index}`} style={currentStyles.separator} />
    case "table":
      return block.rows.map((row, rowIndex) => (
        <Text key={`table-${index}-${rowIndex}`} style={currentStyles.paragraph}>
          {row.map((cell) => cell.trim()).join(" | ")}
        </Text>
      ))
    default:
      return null
  }
}

export const renderWritingToPdfBuffer = async ({ title, bodyText, document }: RenderPdfParams) => {
  const renderWithStyles = async (currentStyles: typeof styles) => {
    const footnoteBlocks = document.footnotes.length
      ? [
          <Text key="footnotes-heading" style={currentStyles.footnoteHeading}>
            Footnotes
          </Text>,
          ...document.footnotes.map((footnote) => (
            <Text key={`footnote-${footnote.index}`} style={currentStyles.footnote}>
              <Text style={currentStyles.footnoteIndex}>[{footnote.index}] </Text>
              {footnote.text}
            </Text>
          )),
        ]
      : []

    const bodyBlocks = document.blocks.length
      ? document.blocks.flatMap((block, index) => renderBlock(block, index, currentStyles) ?? [])
      : bodyText?.trim()
        ? [<Text key="fallback-body" style={currentStyles.paragraph}>{bodyText.trim()}</Text>]
        : []

    const pdfDocument = (
      <Document title={title}>
        <Page size="LETTER" style={currentStyles.page}>
          <Text style={currentStyles.title}>{title}</Text>
          {bodyBlocks}
          {footnoteBlocks}
        </Page>
      </Document>
    )

    return renderToBuffer(pdfDocument)
  }

  try {
    registerFonts()
    return await renderWithStyles(styles)
  } catch (error) {
    console.warn("[export:pdf] Falling back to built-in PDF fonts", error)
    return renderWithStyles(fallbackStyles)
  }
}
