/** Reviewer feedback form schema (shared client/server, /r/{token}). */
import { z } from "zod";

export const reviewResponseSchema = z
  .object({
    decision: z.enum(["approved", "issues"]),
    notes: z.string().trim().max(10_000).optional(),
  })
  .superRefine((data, ctx) => {
    // "Flag issues" without saying what the issues are helps nobody.
    if (data.decision === "issues" && !data.notes?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Describe the issue so the mail program team can address it.",
      });
    }
  });
export type ReviewResponseInput = z.infer<typeof reviewResponseSchema>;
