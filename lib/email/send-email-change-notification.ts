const RESEND_API_URL = "https://api.resend.com/emails"

type TransactionalEmail = {
  to: string
  subject: string
  html: string
}

type EmailChangeNotificationPayload = {
  currentEmail: string
  newEmail: string
  currentEmailActionLink: string
  newEmailActionLink: string
}

async function sendTransactionalEmail({ to, subject, html }: TransactionalEmail) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL ?? "Odessay <accounts@odessay.com>"

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY")
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend request failed: ${response.status} ${body}`)
  }
}

export async function sendEmailChangeNotification({
  currentEmail,
  newEmail,
  currentEmailActionLink,
  newEmailActionLink,
}: EmailChangeNotificationPayload) {
  await Promise.all([
    sendTransactionalEmail({
      to: currentEmail,
      subject: "Odessay account email change requested",
      html: `
        <div style="font-family: Arial, sans-serif; color: #2b241f; line-height: 1.6;">
          <h1 style="font-family: Georgia, serif; font-size: 28px; margin-bottom: 12px;">Email change requested</h1>
          <p>We received a request to change your Odessay account email to <strong>${newEmail}</strong>.</p>
          <p>If this was you, review the request from your current inbox:</p>
          <p><a href="${currentEmailActionLink}">Review or revoke this change</a></p>
          <p>If you did not request this, use the same link to stop the change immediately.</p>
        </div>
      `,
    }),
    sendTransactionalEmail({
      to: newEmail,
      subject: "Confirm your new Odessay email",
      html: `
        <div style="font-family: Arial, sans-serif; color: #2b241f; line-height: 1.6;">
          <h1 style="font-family: Georgia, serif; font-size: 28px; margin-bottom: 12px;">Confirm your new email</h1>
          <p>To finish updating your Odessay account, confirm that you want to use <strong>${newEmail}</strong>.</p>
          <p><a href="${newEmailActionLink}">Confirm new email</a></p>
        </div>
      `,
    }),
  ])
}
