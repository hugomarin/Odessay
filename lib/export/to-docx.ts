import {
  BorderStyle,
  Document as DocxDocument,
  HeadingLevel,
  ImageRun,
  Paragraph,
  Packer,
  Table,
  TableCell,
  TableRow,
  TableLayoutType,
  TextRun,
  WidthType,
  VerticalAlign,
  ShadingType,
} from "docx"
import type { WritingExportBlock, WritingExportDocument, WritingExportInline } from "./writing-export"
import { fetchImageSafely, mapWithConcurrencyLimit } from "./safe-image-fetch"
import * as S from "./styles"

type RenderDocxParams = {
  title: string
  bodyText?: string | null
  document: WritingExportDocument
}

const inlineRunToDocx = (run: WritingExportInline) => {
  return new TextRun({
    text: run.text,
    bold: run.bold || undefined,
    italics: run.italic || undefined,
    strike: run.strike || undefined,
    font: run.code ? S.FONT_FAMILY_CODE_DOCX : S.FONT_FAMILY_BODY,
    size: run.code ? S.ptToHalfPoints(S.CODE_INLINE_FONT_SIZE_PT) : S.FONT_SIZE_BODY_DOCX,
    noProof: run.code || undefined,
    color: run.linkHref ? S.LINK_COLOR : S.TEXT_COLOR,
    underline: run.linkHref ? { type: "single" } : undefined,
    shading: run.highlight
      ? {
          type: ShadingType.CLEAR,
          fill: S.HIGHLIGHT_COLOR.replace("#", ""),
        }
      : undefined,
  })
}

const imageFallbackParagraph = (src: string, alt?: string | null) =>
  new Paragraph({
    children: [
      new TextRun({
        text: alt?.trim() || "Image",
        bold: true,
        font: S.FONT_FAMILY_BODY,
        size: S.FONT_SIZE_BODY_DOCX,
      }),
      new TextRun({
        text: `: ${src}`,
        font: S.FONT_FAMILY_BODY,
        size: S.FONT_SIZE_BODY_DOCX,
        color: S.LINK_COLOR,
        underline: { type: "single" },
      }),
    ],
    spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
  })

// ODE-522: the raw `fetch(src)` this replaced followed redirects
// automatically, trusted Content-Type without decoding, and had no size
// cap — the audit reproduced a redirect to loopback and non-image bytes
// embedded straight into the document. fetchImageSafely is the one place
// that validates scheme, destination and bytes for both export formats.
const imageBlockToDocx = async (block: Extract<WritingExportBlock, { type: "image" }>) => {
  const result = await fetchImageSafely(block.image.src)
  if (!result.ok) {
    return [imageFallbackParagraph(block.image.src, block.image.alt)]
  }

  return [
    new Paragraph({
      children: [
        new ImageRun({
          type: result.format,
          data: result.data,
          transformation: {
            width: S.IMAGE_MAX_WIDTH_PX,
            height: S.IMAGE_MAX_HEIGHT_PX,
          },
        }),
      ],
      spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
    }),
  ]
}

const IMAGE_FETCH_CONCURRENCY = 4

const codeBlockRunsToDocx = (code: string) =>
  code.split("\n").map(
    (line, index) =>
      new TextRun({
        text: line.length ? line : " ",
        break: index === 0 ? undefined : 1,
        font: S.FONT_FAMILY_CODE_DOCX,
        size: S.ptToHalfPoints(S.CODE_BLOCK_FONT_SIZE_PT),
        color: S.CODE_BLOCK_TEXT_COLOR.replace("#", ""),
        noProof: true,
      }),
  )

export const blockToElements = (block: WritingExportBlock): (Paragraph | Table)[] => {
  switch (block.type) {
    case "paragraph":
      return [
        new Paragraph({
          children: block.inlines.map(inlineRunToDocx),
          spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
        }),
      ]
    case "heading":
      return [
        new Paragraph({
          text: block.inlines.map((run) => run.text).join(""),
          heading:
            block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: {
            after: S.ptToTwips(block.level === 1 ? S.HEADING_MARGIN_BOTTOM_H1_PT : block.level === 2 ? S.HEADING_MARGIN_BOTTOM_H2_PT : S.HEADING_MARGIN_BOTTOM_H3_PT),
            before: S.ptToTwips(S.HEADING_MARGIN_TOP_PT),
          },
        }),
      ]
    case "blockquote":
      return [
        new Paragraph({
          children: block.inlines.map(inlineRunToDocx),
          indent: { left: S.BLOCKQUOTE_INDENT_DOCX },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              color: S.BLOCKQUOTE_BORDER_COLOR.replace("#", ""),
              size: S.BLOCKQUOTE_BORDER_WIDTH_PX * 4,
            },
          },
          spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
        }),
      ]
    case "bulletList":
      return block.items.map(
        (item) =>
          new Paragraph({
            children: [
              new TextRun({ text: "• ", bold: true, font: S.FONT_FAMILY_BODY, size: S.FONT_SIZE_BODY_DOCX }),
              ...item.map(inlineRunToDocx),
            ],
            spacing: { after: S.LIST_ITEM_MARGIN_BOTTOM_DOCX },
            indent: { left: S.LIST_INDENT_DOCX },
          }),
      )
    case "orderedList":
      return block.items.map(
        (item, itemIndex) =>
          new Paragraph({
            children: [
              new TextRun({
                text: `${itemIndex + 1}. `,
                bold: true,
                font: S.FONT_FAMILY_BODY,
                size: S.FONT_SIZE_BODY_DOCX,
              }),
              ...item.map(inlineRunToDocx),
            ],
            spacing: { after: S.LIST_ITEM_MARGIN_BOTTOM_DOCX },
            indent: { left: S.LIST_INDENT_DOCX },
          }),
      )
    case "codeBlock": {
      // ODE-533: content-preserving Mermaid fallback for export. The diagram
      // source is always included with a caption — content is never omitted.
      const isMermaid = (block.language ?? "").trim().toLowerCase() === "mermaid"
      const caption = isMermaid
        ? [
            new Paragraph({
              children: [
                new TextRun({
                  text: "Diagram source (mermaid):",
                  font: S.FONT_FAMILY_BODY,
                  size: S.FONT_SIZE_BODY_DOCX,
                }),
              ],
              spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
            }),
          ]
        : []
      return [
        ...caption,
        new Paragraph({
          children: codeBlockRunsToDocx(block.code.trimEnd()),
          spacing: {
            before: S.ptToTwips(4),
            after: S.ptToTwips(S.CODE_BLOCK_MARGIN_BOTTOM_PT),
            line: S.CODE_BLOCK_LINE_HEIGHT_DOCX,
          },
          indent: {
            left: S.CODE_BLOCK_PADDING_TWIPS,
            right: S.CODE_BLOCK_PADDING_TWIPS,
          },
          border: {
            top: { style: BorderStyle.SINGLE, color: S.CODE_BLOCK_BORDER_COLOR.replace("#", ""), size: 4, space: 6 },
            bottom: { style: BorderStyle.SINGLE, color: S.CODE_BLOCK_BORDER_COLOR.replace("#", ""), size: 4, space: 6 },
            left: { style: BorderStyle.SINGLE, color: S.CODE_BLOCK_BORDER_COLOR.replace("#", ""), size: 4, space: 6 },
            right: { style: BorderStyle.SINGLE, color: S.CODE_BLOCK_BORDER_COLOR.replace("#", ""), size: 4, space: 6 },
          },
          shading: {
            type: ShadingType.CLEAR,
            fill: S.CODE_BLOCK_BACKGROUND.replace("#", ""),
          },
        }),
      ]
    }
    case "separator":
      return [
        new Paragraph({
          children: [],
          spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              color: S.SEPARATOR_COLOR.replace("#", ""),
              size: 6,
            },
          },
        }),
      ]
    case "table": {
      const rows = block.rows
      if (!rows.length) return []
      const columnCount = Math.max(...rows.map((row) => row.length), 1)
      const columnWidthTwips = Math.floor(S.PAGE_CONTENT_WIDTH_TWIPS / columnCount)
      const columnWidths = Array.from({ length: columnCount }, () => columnWidthTwips)

      const table = new Table({
        layout: TableLayoutType.FIXED,
        width: { size: S.PAGE_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
        columnWidths,
        rows: rows.map((row, rowIndex) => {
          const isHeader = rowIndex === 0
          return new TableRow({
            children: row.map((cell) => {
              return new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell.trim(),
                        font: S.FONT_FAMILY_BODY,
                        size: S.FONT_SIZE_BODY_DOCX,
                        color: S.TEXT_COLOR,
                      }),
                    ],
                    spacing: { after: 0 },
                  }),
                ],
                margins: {
                  top: S.TABLE_CELL_PADDING_TWIPS,
                  bottom: S.TABLE_CELL_PADDING_TWIPS,
                  left: S.TABLE_CELL_PADDING_TWIPS,
                  right: S.TABLE_CELL_PADDING_TWIPS,
                },
                shading: isHeader
                  ? {
                      type: ShadingType.CLEAR,
                      fill: S.TABLE_HEADER_BACKGROUND.replace("#", ""),
                    }
                  : undefined,
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: S.TABLE_BORDER_COLOR.replace("#", "") },
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: S.TABLE_BORDER_COLOR.replace("#", "") },
                  left: { style: BorderStyle.SINGLE, size: 4, color: S.TABLE_BORDER_COLOR.replace("#", "") },
                  right: { style: BorderStyle.SINGLE, size: 4, color: S.TABLE_BORDER_COLOR.replace("#", "") },
                },
                width: { size: columnWidthTwips, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
              })
            }),
          })
        }),
      })

      return [
        table,
        new Paragraph({
          children: [],
          spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
        }),
      ]
    }
    case "image":
      return [imageFallbackParagraph(block.image.src, block.image.alt)]
    default:
      return []
  }
}

const blockToElementsAsync = async (block: WritingExportBlock): Promise<(Paragraph | Table)[]> => {
  if (block.type === "image") {
    return imageBlockToDocx(block)
  }

  return blockToElements(block)
}

const buildDocxDocument = async ({ title, bodyText, document }: RenderDocxParams) => {
  // ODE-522: bounded concurrency, not one Promise.all fetching every image
  // in the document at once — a document with many images must not open
  // an unbounded number of simultaneous outbound connections.
  const bodyElements = document.blocks.length
    ? (
        await mapWithConcurrencyLimit(document.blocks, IMAGE_FETCH_CONCURRENCY, (block) =>
          blockToElementsAsync(block),
        )
      ).flat()
    : bodyText?.trim()
      ? [
          new Paragraph({
            text: bodyText.trim(),
            spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
          }),
        ]
      : []

  const footnoteParagraphs = document.footnotes.length
    ? [
        new Paragraph({
          text: "Footnotes",
          heading: HeadingLevel.HEADING_2,
          spacing: {
            before: S.ptToTwips(S.FOOTNOTE_HEADING_MARGIN_TOP_PT),
            after: S.ptToTwips(S.FOOTNOTE_HEADING_MARGIN_BOTTOM_PT),
          },
        }),
        ...document.footnotes.map(
          (footnote) =>
            new Paragraph({
              children: [
                new TextRun({
                  text: `[${footnote.index}] `,
                  bold: true,
                  font: S.FONT_FAMILY_BODY,
                  size: S.ptToHalfPoints(S.FOOTNOTE_FONT_SIZE_PT),
                }),
                new TextRun({
                  text: footnote.text,
                  font: S.FONT_FAMILY_BODY,
                  size: S.ptToHalfPoints(S.FOOTNOTE_FONT_SIZE_PT),
                }),
              ],
              spacing: { after: S.FOOTNOTE_MARGIN_BOTTOM_DOCX },
            }),
        ),
      ]
    : []

  return new DocxDocument({
    styles: {
      default: {
        document: {
          run: {
            font: S.FONT_FAMILY_BODY,
            size: S.FONT_SIZE_BODY_DOCX,
            color: S.TEXT_COLOR.replace("#", ""),
          },
          paragraph: {
            spacing: { line: S.LINE_HEIGHT_DOCX, after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
          },
        },
      },
      paragraphStyles: [
        {
          id: "CodeInline",
          name: "CodeInline",
          basedOn: "Normal",
          run: {
            font: S.FONT_FAMILY_CODE_DOCX,
            size: S.ptToHalfPoints(S.CODE_INLINE_FONT_SIZE_PT),
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: S.PAGE_MARGIN_VERTICAL_TWIPS,
              right: S.PAGE_MARGIN_HORIZONTAL_TWIPS,
              bottom: S.PAGE_MARGIN_VERTICAL_TWIPS,
              left: S.PAGE_MARGIN_HORIZONTAL_TWIPS,
            },
          },
        },
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: S.ptToTwips(S.TITLE_MARGIN_BOTTOM_PT) },
          }),
          ...bodyElements,
          ...footnoteParagraphs,
        ],
      },
    ],
  })
}

export const renderWritingToDocxBytes = async (params: RenderDocxParams) => {
  const doc = await buildDocxDocument(params)
  return new Uint8Array(await Packer.toArrayBuffer(doc))
}

export const renderWritingToDocxBuffer = async (params: RenderDocxParams) => {
  const doc = await buildDocxDocument(params)
  return Packer.toBuffer(doc)
}
