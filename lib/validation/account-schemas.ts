import { z } from "zod"
import { normalizeEmail, normalizeUsername } from "@/lib/auth/validation"

export const ACCOUNT_USERNAME_PATTERN = /^[a-z0-9_-]{3,30}$/

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(60, "Use 60 characters or fewer.")

export const usernameSchema = z
  .string()
  .trim()
  .transform((value) => normalizeUsername(value))
  .refine((value) => ACCOUNT_USERNAME_PATTERN.test(value), {
    message: "Use 3-30 lowercase letters, numbers, underscores, or hyphens.",
  })

export const emailSchema = z
  .string()
  .trim()
  .transform((value) => normalizeEmail(value))
  .pipe(z.email("Enter a valid email address."))

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.")

export const updateDisplayNameSchema = z.object({
  displayName: displayNameSchema,
})

export const updateUsernameSchema = z.object({
  username: usernameSchema,
})

export const updateEmailSchema = z.object({
  email: emailSchema,
})

export const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .superRefine((value, ctx) => {
    if (value.newPassword === value.currentPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a password different from the current one.",
        path: ["newPassword"],
      })
    }

    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      })
    }
  })

export type UpdateDisplayNameInput = z.infer<typeof updateDisplayNameSchema>
export type UpdateUsernameInput = z.infer<typeof updateUsernameSchema>
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>
