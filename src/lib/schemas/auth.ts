/** Auth request schemas, shared client/server (SPEC §2: Zod on every boundary). */
import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  turnstileToken: z.string().min(1, "Complete the verification challenge."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  // §7: minimum length 12; no other composition rules.
  newPassword: z
    .string()
    .min(12, "New password must be at least 12 characters."),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
