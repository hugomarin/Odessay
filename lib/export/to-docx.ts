import {
  BorderStyle,
  Document as DocxDocument,
  HeadingLevel,
  Paragraph,
  Packer,
  TextRun,
} from "docx"
import type { WritingExportBlock, WritingExportDocument, WritingExportInline } from "./writing-export"

type RenderDocxParams = {
  title: string
  bodyText?: string | null
  document: WritingExportDocument
}

const inlineRunToDocx = (run: WritingExportInline) => {
  const options = {
    text: run.text,
    bold: run.bold || undefined,
    italics: run.italic || undefined,
    strike: run.strike || undefined,
    highlight: run.highlight ? "yellow" : undefined,
    font: run.code ? "Courier New" : undefined,
  } satisfies ConstructorParameters<typeof TextRun>[0]

  return new TextRun(options)
}

const blockToParagraphs = (block: WritingExportBlock): Paragraph[] => {
  switch (block.type) {
    case "paragraph":
      return [
        new Paragraph({
          children: block.inlines.map(inlineRunToDocx),
          spacing: { after: 180 },
        }),
      ]
    case "heading":
      return [
        new Paragraph({
          text: block.inlines.map((run) => run.text).join(""),
          heading:
            block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { after: 180, before: block.level === 1 ? 120 : 80 },
        }),
      ]
    case "blockquote":
      return [
        new Paragraph({
          children: block.inlines.map(inlineRunToDocx),
          indent: { left: 720 },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              color: "8A6F55",
              size: 10,
            },
          },
          spacing: { after: 180 },
        }),
      ]
    case "bulletList":
      return block.items.map(
        (item) =>
          new Paragraph({
            children: [new TextRun({ text: "• ", bold: true }), ...item.map(inlineRunToDocx)],
            spacing: { after: 120 },
            indent: { left: 360 },
          }),
      )
    case "orderedList":
      return block.items.map(
        (item, itemIndex) =>
          new Paragraph({
            children: [new TextRun({ text: `${itemIndex + 1}. `, bold: true }), ...item.map(inlineRunToDocx)],
            spacing: { after: 120 },
            indent: { left: 360 },
          }),
      )
    case "codeBlock":
      return [
        new Paragraph({
          children: [new TextRun({ text: block.code.trimEnd(), font: "Courier New" })],
          spacing: { after: 180 },
        }),
      ]
    case "separator":
      return [
        new Paragraph({
          children: [],
          spacing: { after: 180 },
        }),
      ]
    case "table":
      return block.rows.map(
        (row) =>
          new Paragraph({
            children: [new TextRun({ text: row.map((cell) => cell.trim()).join(" | ") })],
            spacing: { after: 120 },
          }),
      )
    default:
      return []
  }
}

export const renderWritingToDocxBuffer = async ({ title, bodyText, document }: RenderDocxParams) => {
  const bodyParagraphs = document.blocks.length
    ? document.blocks.flatMap((block) => blockToParagraphs(block))
    : bodyText?.trim()
      ? [new Paragraph({ text: bodyText.trim(), spacing: { after: 180 } })]
      : []

  const footnoteParagraphs = document.footnotes.length
    ? [
        new Paragraph({
          text: "Footnotes",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
        }),
        ...document.footnotes.map(
          (footnote) =>
            new Paragraph({
              children: [
                new TextRun({ text: `[${footnote.index}] `, bold: true }),
                new TextRun({ text: footnote.text }),
              ],
              spacing: { after: 120 },
            }),
        ),
      ]
    : []

  const doc = new DocxDocument({
    styles: {
      default: {
        document: {
          run: {
            font: "Geist Sans",
            size: 24,
          },
          paragraph: {
            spacing: { line: 420, after: 180 },
          },
        },
      },
      paragraphStyles: [
        {
          id: "CodeInline",
          name: "CodeInline",
          basedOn: "Normal",
          run: {
            font: "Courier New",
          },
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 240 },
          }),
          ...bodyParagraphs,
          ...footnoteParagraphs,
        ],
      },
    ],
  })

  return Packer.toBuffer(doc)
}
