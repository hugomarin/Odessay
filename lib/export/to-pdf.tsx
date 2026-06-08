import React from "react"
import type { ReactNode } from "react"
import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer"
import type { WritingExportBlock, WritingExportDocument, WritingExportInline } from "./writing-export"
import * as S from "./styles"

type RenderPdfParams = {
  title: string
  bodyText?: string | null
  document: WritingExportDocument
}

let codeFontRegistered = false

const getCodeFontSource = () =>
  typeof window === "undefined" ? `${process.cwd()}/public${S.FONT_PATH_CODE}` : S.FONT_PATH_CODE

const registerCodeFont = () => {
  if (codeFontRegistered) {
    return
  }

  Font.register({
    family: S.FONT_FAMILY_CODE,
    src: getCodeFontSource(),
  })
  codeFontRegistered = true
}

const createStyles = (bodyFontFamily: string, codeFontFamily = S.FONT_FAMILY_CODE) =>
  StyleSheet.create({
    page: {
      paddingHorizontal: S.PAGE_MARGIN_HORIZONTAL_PX,
      paddingVertical: S.PAGE_MARGIN_VERTICAL_PX,
      fontFamily: bodyFontFamily,
      fontSize: S.FONT_SIZE_BODY_PDF,
      lineHeight: S.LINE_HEIGHT,
      color: S.TEXT_COLOR,
      backgroundColor: S.PAGE_BACKGROUND_COLOR,
    },
    title: {
      fontFamily: S.FONT_FAMILY_HEADING,
      fontSize: S.FONT_SIZE_TITLE_PT,
      lineHeight: 1.2,
      marginBottom: S.TITLE_MARGIN_BOTTOM_PT,
      color: S.TEXT_COLOR,
    },
    paragraph: {
      marginBottom: S.PARAGRAPH_MARGIN_BOTTOM_PT,
    },
    heading1: {
      fontFamily: S.FONT_FAMILY_HEADING_BOLD,
      fontSize: S.FONT_SIZE_H1_PT,
      lineHeight: 1.25,
      marginBottom: S.HEADING_MARGIN_BOTTOM_H1_PT,
      marginTop: S.HEADING_MARGIN_TOP_PT,
    },
    heading2: {
      fontFamily: S.FONT_FAMILY_HEADING_BOLD,
      fontSize: S.FONT_SIZE_H2_PT,
      lineHeight: 1.25,
      marginBottom: S.HEADING_MARGIN_BOTTOM_H2_PT,
      marginTop: S.HEADING_MARGIN_TOP_PT,
    },
    heading3: {
      fontFamily: S.FONT_FAMILY_HEADING_BOLD,
      fontSize: S.FONT_SIZE_H3_PT,
      lineHeight: 1.25,
      marginBottom: S.HEADING_MARGIN_BOTTOM_H3_PT,
      marginTop: S.HEADING_MARGIN_TOP_PT,
    },
    blockquote: {
      marginBottom: S.PARAGRAPH_MARGIN_BOTTOM_PT,
      paddingLeft: S.BLOCKQUOTE_PADDING_LEFT_PX,
      borderLeftWidth: S.BLOCKQUOTE_BORDER_WIDTH_PX,
      borderLeftColor: S.BLOCKQUOTE_BORDER_COLOR,
    },
    blockquoteText: {
      fontFamily: bodyFontFamily,
      fontStyle: "italic",
      color: S.BLOCKQUOTE_TEXT_COLOR,
    },
    listItem: {
      marginBottom: S.LIST_ITEM_MARGIN_BOTTOM_PT,
    },
    codeBlock: {
      fontFamily: codeFontFamily,
      fontSize: S.CODE_BLOCK_FONT_SIZE_PT,
      lineHeight: S.CODE_BLOCK_LINE_HEIGHT,
      color: S.CODE_BLOCK_TEXT_COLOR,
      backgroundColor: S.CODE_BLOCK_BACKGROUND,
      borderWidth: 1,
      borderColor: S.CODE_BLOCK_BORDER_COLOR,
      padding: S.CODE_BLOCK_PADDING_PX,
      borderRadius: S.CODE_BLOCK_BORDER_RADIUS_PX,
      marginBottom: S.CODE_BLOCK_MARGIN_BOTTOM_PT,
    },
    separator: {
      marginVertical: S.SEPARATOR_MARGIN_VERTICAL_PT,
      borderBottomWidth: 1,
      borderBottomColor: S.SEPARATOR_COLOR,
    },
    footnoteHeading: {
      marginTop: S.FOOTNOTE_HEADING_MARGIN_TOP_PT,
      marginBottom: S.FOOTNOTE_HEADING_MARGIN_BOTTOM_PT,
      fontFamily: S.FONT_FAMILY_HEADING_BOLD,
      fontSize: S.FOOTNOTE_HEADING_FONT_SIZE_PT,
    },
    footnote: {
      marginBottom: S.FOOTNOTE_MARGIN_BOTTOM_PT,
      fontSize: S.FOOTNOTE_FONT_SIZE_PT,
      lineHeight: S.FOOTNOTE_LINE_HEIGHT,
    },
    footnoteIndex: {
      fontFamily: S.FONT_FAMILY_HEADING_BOLD,
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
      fontFamily: codeFontFamily,
      fontSize: S.CODE_INLINE_FONT_SIZE_PT,
    },
    highlight: {
      backgroundColor: S.HIGHLIGHT_COLOR,
    },
    link: {
      color: S.LINK_COLOR,
      textDecorationLine: "underline",
    },
    table: {
      marginBottom: S.PARAGRAPH_MARGIN_BOTTOM_PT,
      borderWidth: 1,
      borderColor: S.TABLE_BORDER_COLOR,
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: S.TABLE_BORDER_COLOR,
    },
    tableRowLast: {
      flexDirection: "row",
    },
    tableCell: {
      flex: 1,
      padding: S.TABLE_CELL_PADDING_PX,
      borderRightWidth: 1,
      borderRightColor: S.TABLE_BORDER_COLOR,
    },
    tableCellLast: {
      flex: 1,
      padding: S.TABLE_CELL_PADDING_PX,
    },
    tableHeaderCell: {
      flex: 1,
      padding: S.TABLE_CELL_PADDING_PX,
      borderRightWidth: 1,
      borderRightColor: S.TABLE_BORDER_COLOR,
      backgroundColor: S.TABLE_HEADER_BACKGROUND,
    },
    tableHeaderCellLast: {
      flex: 1,
      padding: S.TABLE_CELL_PADDING_PX,
      backgroundColor: S.TABLE_HEADER_BACKGROUND,
    },
    image: {
      width: S.IMAGE_MAX_WIDTH_PX,
      maxHeight: S.IMAGE_MAX_HEIGHT_PX,
      objectFit: "contain",
      marginBottom: S.PARAGRAPH_MARGIN_BOTTOM_PT,
    },
    imageFallback: {
      marginBottom: S.PARAGRAPH_MARGIN_BOTTOM_PT,
      color: S.LINK_COLOR,
      textDecorationLine: "underline",
    },
  })

const styles = createStyles(S.FONT_FAMILY_FALLBACK)
const fallbackStyles = createStyles("Helvetica", S.FONT_FAMILY_CODE_FALLBACK)

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

const renderBlock = (block: WritingExportBlock, index: number, currentStyles = styles, renderImages = true): ReactNode => {
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
    case "table": {
      const rows = block.rows
      if (!rows.length) return null
      return (
        <View key={`table-${index}`} style={currentStyles.table}>
          {rows.map((row, rowIndex) => {
            const isLastRow = rowIndex === rows.length - 1
            const isHeader = rowIndex === 0
            const rowStyle = isLastRow ? currentStyles.tableRowLast : currentStyles.tableRow
            return (
              <View key={`table-${index}-${rowIndex}`} style={rowStyle}>
                {row.map((cell, cellIndex) => {
                  const isLastCell = cellIndex === row.length - 1
                  let cellStyle
                  if (isHeader) {
                    cellStyle = isLastCell ? currentStyles.tableHeaderCellLast : currentStyles.tableHeaderCell
                  } else {
                    cellStyle = isLastCell ? currentStyles.tableCellLast : currentStyles.tableCell
                  }
                  return (
                    <Text key={`table-${index}-${rowIndex}-${cellIndex}`} style={cellStyle}>
                      {cell.trim()}
                    </Text>
                  )
                })}
              </View>
            )
          })}
        </View>
      )
    }
    case "image":
      return renderImages ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose the DOM alt prop.
        <Image key={`image-${index}`} src={block.image.src} style={currentStyles.image} />
      ) : (
        <Text key={`image-fallback-${index}`} style={currentStyles.imageFallback}>
          {block.image.alt?.trim() || "Image"}: {block.image.src}
        </Text>
      )
    default:
      return null
  }
}

const renderWritingToPdfBlob = async ({ title, bodyText, document }: RenderPdfParams, renderImages = true) => {
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
      ? document.blocks.flatMap((block, index) => renderBlock(block, index, currentStyles, renderImages) ?? [])
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

    return pdf(pdfDocument).toBlob()
  }

  try {
    registerCodeFont()
    return await renderWithStyles(styles)
  } catch (error) {
    console.warn("[export:pdf] Falling back to built-in PDF rendering", error)
    return renderWithStyles(fallbackStyles)
  }
}

export const renderWritingToPdfBytes = async (params: RenderPdfParams) => {
  try {
    const blob = await renderWritingToPdfBlob(params, true)
    return new Uint8Array(await blob.arrayBuffer())
  } catch (error) {
    console.warn("[export:pdf] Falling back to image links", error)
    const blob = await renderWritingToPdfBlob(params, false)
    return new Uint8Array(await blob.arrayBuffer())
  }
}

export const renderWritingToPdfBuffer = async (params: RenderPdfParams) => {
  return Buffer.from(await renderWritingToPdfBytes(params))
}
