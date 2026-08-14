/** Admin action request schemas (shared client/server). */
import { z } from "zod";
import { REVIEW_DECISIONS, REVIEW_STAGES } from "@/lib/state-machine";

export const reviewDecisionSchema = z
  .object({
    stage: z.enum(REVIEW_STAGES),
    decision: z.enum(REVIEW_DECISIONS),
    checklist: z.record(z.string(), z.boolean()).default({}),
    notes: z.string().trim().max(10_000).optional(),
  })
  .superRefine((data, ctx) => {
    // Vendors receive these notes verbatim (§12) — require them when the
    // decision is a kickback or denial.
    if (
      (data.decision === "changes_requested" || data.decision === "denied") &&
      !data.notes?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message:
          data.decision === "changes_requested"
            ? "Explain what needs to change — the vendor sees these notes."
            : "Give a reason — the vendor sees these notes.",
      });
    }
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const setPaidSchema = z.object({
  contactId: z.uuid(),
  paid: z.boolean(),
});

export const deleteProjectSchema = z.object({
  confirmName: z.string().min(1, "Type the candidate name to confirm."),
});

export const reopenSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to reopen."),
});

export const createAdminSchema = z.object({
  email: z.email("Enter a valid email address."),
  name: z.string().trim().min(1, "Name is required.").max(200),
  isSuperuser: z.boolean().default(false),
});
