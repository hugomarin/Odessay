/**
 * Shared export styles — single source of truth for PDF and DOCX rendering.
 * Both exporters must consume these values. No hardcoded styles elsewhere.
 */

// ── Page ──
export const PAGE_BACKGROUND_COLOR = "#ffffff"
export const PAGE_MARGIN_HORIZONTAL_PX = 60
export const PAGE_MARGIN_VERTICAL_PX = 72
export const PAGE_MARGIN_HORIZONTAL_TWIPS = 1440 // ~1 inch
export const PAGE_MARGIN_VERTICAL_TWIPS = 1440   // ~1 inch
export const PAGE_WIDTH_LETTER_TWIPS = 12240
export const PAGE_CONTENT_WIDTH_TWIPS = PAGE_WIDTH_LETTER_TWIPS - PAGE_MARGIN_HORIZONTAL_TWIPS * 2

// ── Typography — body ──
export const FONT_FAMILY_BODY = "Geist Sans"
export const FONT_FAMILY_FALLBACK = "Helvetica"
export const FONT_FAMILY_HEADING = "Times-Roman"
export const FONT_FAMILY_HEADING_BOLD = "Times-Bold"
export const FONT_FAMILY_CODE = "Courier"
export const FONT_FAMILY_CODE_DOCX = "Courier New"

export const FONT_SIZE_BODY_PT = 11
export const FONT_SIZE_BODY_PDF = 11
export const FONT_SIZE_BODY_DOCX = 22 // half-points

export const LINE_HEIGHT = 1.6
export const LINE_HEIGHT_DOCX = 360 // twips (~1.6 at 11pt)

export const TEXT_COLOR = "#161310"

// ── Typography — title ──
export const FONT_SIZE_TITLE_PT = 24
export const TITLE_MARGIN_BOTTOM_PT = 20

// ── Typography — headings ──
export const FONT_SIZE_H1_PT = 20
export const FONT_SIZE_H2_PT = 17
export const FONT_SIZE_H3_PT = 15
export const HEADING_MARGIN_TOP_PT = 8
export const HEADING_MARGIN_BOTTOM_H1_PT = 14
export const HEADING_MARGIN_BOTTOM_H2_PT = 12
export const HEADING_MARGIN_BOTTOM_H3_PT = 10

// ── Paragraphs ──
export const PARAGRAPH_MARGIN_BOTTOM_PT = 12
export const PARAGRAPH_MARGIN_BOTTOM_DOCX = 240 // twips (~12pt)

// ── Blockquotes ──
export const BLOCKQUOTE_BORDER_COLOR = "#675d51"
export const BLOCKQUOTE_BORDER_WIDTH_PX = 2
export const BLOCKQUOTE_PADDING_LEFT_PX = 14
export const BLOCKQUOTE_TEXT_COLOR = "#2f2a25"
export const BLOCKQUOTE_INDENT_DOCX = 720 // twips

// ── Lists ──
export const LIST_ITEM_MARGIN_BOTTOM_PT = 6
export const LIST_ITEM_MARGIN_BOTTOM_DOCX = 120 // twips
export const LIST_INDENT_DOCX = 360 // twips

// ── Code blocks ──
export const CODE_BLOCK_FONT_SIZE_PT = 10
export const CODE_BLOCK_LINE_HEIGHT = 1.5
export const CODE_BLOCK_BACKGROUND = "#eee5d6"
export const CODE_BLOCK_PADDING_PX = 10
export const CODE_BLOCK_BORDER_RADIUS_PX = 6
export const CODE_BLOCK_MARGIN_BOTTOM_PT = 12

// ── Inline code ──
export const CODE_INLINE_FONT_SIZE_PT = 10

// ── Separator / horizontal rule ──
export const SEPARATOR_COLOR = "#d8cec0"
export const SEPARATOR_MARGIN_VERTICAL_PT = 14

// ── Footnotes ──
export const FOOTNOTE_HEADING_MARGIN_TOP_PT = 24
export const FOOTNOTE_HEADING_MARGIN_BOTTOM_PT = 12
export const FOOTNOTE_HEADING_FONT_SIZE_PT = 14
export const FOOTNOTE_FONT_SIZE_PT = 10
export const FOOTNOTE_LINE_HEIGHT = 1.5
export const FOOTNOTE_MARGIN_BOTTOM_PT = 6
export const FOOTNOTE_MARGIN_BOTTOM_DOCX = 120 // twips

// ── Highlights ──
export const HIGHLIGHT_COLOR = "#f6e39c"

// ── Links ──
export const LINK_COLOR = "#6a4d2f"

// ── Table defaults ──
export const TABLE_BORDER_COLOR = "#d8cec0"
export const TABLE_HEADER_BACKGROUND = "#f8f3ea"
export const TABLE_CELL_PADDING_PX = 6
export const TABLE_CELL_PADDING_TWIPS = Math.round(TABLE_CELL_PADDING_PX * 15)

// ── Conversion helpers ──

/** Convert points to pixels (at 96 DPI, 1pt ≈ 1.333px) */
export const ptToPx = (pt: number) => Math.round(pt * 1.333)

/** Convert points to DOCX half-points */
export const ptToHalfPoints = (pt: number) => Math.round(pt * 2)

/** Convert points to twips (1pt = 20 twips) */
export const ptToTwips = (pt: number) => Math.round(pt * 20)
