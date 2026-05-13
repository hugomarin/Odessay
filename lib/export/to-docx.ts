import {
  BorderStyle,
  Document as DocxDocument,
  HeadingLevel,
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
    case "codeBlock":
      return [
        new Paragraph({
          children: [
            new TextRun({
              text: block.code.trimEnd(),
              font: S.FONT_FAMILY_CODE_DOCX,
              size: S.ptToHalfPoints(S.CODE_BLOCK_FONT_SIZE_PT),
            }),
          ],
          spacing: { after: S.PARAGRAPH_MARGIN_BOTTOM_DOCX },
          shading: {
            type: ShadingType.CLEAR,
            fill: S.CODE_BLOCK_BACKGROUND.replace("#", ""),
          },
        }),
      ]
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
      const columnCount = rows[0].length || 1
      const cellWidthPct = Math.floor(100 / columnCount)

      const table = new Table({
        layout: TableLayoutType.AUTOFIT,
        width: { size: 100, type: WidthType.PERCENTAGE },
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
                  top: Math.round(S.TABLE_CELL_PADDING_PX * 15),
                  bottom: Math.round(S.TABLE_CELL_PADDING_PX * 15),
                  left: Math.round(S.TABLE_CELL_PADDING_PX * 15),
                  right: Math.round(S.TABLE_CELL_PADDING_PX * 15),
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
    default:
      return []
  }
}

export const renderWritingToDocxBuffer = async ({ title, bodyText, document }: RenderDocxParams) => {
  const bodyElements = document.blocks.length
    ? document.blocks.flatMap((block) => blockToElements(block))
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

  const doc = new DocxDocument({
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

  return Packer.toBuffer(doc)
}
