import { randomBytes } from "node:crypto"

export const TEST_LINK_EMAIL_PREFIX = "ux-eval+"
export const TEST_LINK_EMAIL_DOMAIN = "odessay.local"

export type TestLinkInvitationRow = {
  token: string
  email: string
  status: "pending" | "accepted" | "expired"
  created_at: string
}

const toTimestamp = (isoDate: string) => {
  const timestamp = Date.parse(isoDate)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export const createTestLinkToken = () => randomBytes(24).toString("base64url")

export const getTestLinkEmail = (writingId: string) =>
  `${TEST_LINK_EMAIL_PREFIX}${writingId}@${TEST_LINK_EMAIL_DOMAIN}`

export const isTestLinkEmail = (email: string) =>
  email.startsWith(TEST_LINK_EMAIL_PREFIX) && email.endsWith(`@${TEST_LINK_EMAIL_DOMAIN}`)

export const buildTestLinkPath = (token: string) => `/preview/${token}`

export const pickLatestPendingTestLink = (
  rows: TestLinkInvitationRow[],
  writingId: string,
): TestLinkInvitationRow | null => {
  const markerEmail = getTestLinkEmail(writingId)

  const [latest] = rows
    .filter((row) => row.status === "pending" && row.email === markerEmail)
    .sort((left, right) => toTimestamp(right.created_at) - toTimestamp(left.created_at))

  return latest ?? null
}
