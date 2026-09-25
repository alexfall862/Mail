/** Admin action request schemas (shared client/server). */
import { z } from "zod";
import { REVIEW_DECISIONS, REVIEW_STAGES } from "@/lib/state-machine";

/** Recipient options for admin-triggered outgoing emails. Blank slate by
 * default: nothing is CC'd unless the sender opts in per send. */
export const emailOptionsSchema = z.object({
  /** CC the admin team (all active admin accounts). Defaults off. */
  ccAdmins: z.boolean().default(false),
  /** Additional parties to include (CC). */
  extraCc: z.array(z.email("Invalid additional email.")).max(10).default([]),
});
export type EmailOptions = z.infer<typeof emailOptionsSchema>;

export const reviewDecisionSchema = z
  .object({
    stage: z.enum(REVIEW_STAGES),
    decision: z.enum(REVIEW_DECISIONS),
    checklist: z.record(z.string(), z.boolean()).default({}),
    notes: z.string().trim().max(10_000).optional(),
    /** Off = suppress the vendor email for this decision (late-revision
     * churn); the status page still updates and the suppression is audited. */
    notifyVendor: z.boolean().default(true),
    emailOptions: emailOptionsSchema.default({ ccAdmins: false, extraCc: [] }),
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
            ? "Explain what needs to change. The vendor sees these notes."
            : "Give a reason. The vendor sees these notes.",
      });
    }
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

/** Longest check reference we accept; real check numbers are far shorter. */
export const CHECK_NUMBER_MAX = 40;

export const setPaidSchema = z.object({
  contactId: z.uuid(),
  paid: z.boolean(),
  /** Check that covered this vendor. Omitted = leave as is (when already
   * paid) or none (when newly marking paid); "" clears it. */
  checkNumber: z.string().trim().max(CHECK_NUMBER_MAX).optional(),
  /** Amount on the check for this vendor, in cents. Omitted = leave as is;
   * null clears it. */
  amountCents: z
    .number()
    .int()
    .min(0)
    .max(1_000_000_000) // $10M — a sanity bound, not a business rule
    .nullable()
    .optional(),
});
export type SetPaidInput = z.infer<typeof setPaidSchema>;

/** Admin amendment of an approved project's total cost (final invoice differs
 * from the quote). Cents; the same sanity bound as payment amounts. */
export const amendCostSchema = z.object({
  totalCostCents: z.number().int().min(0).max(1_000_000_000),
  reason: z.string().trim().max(500).optional(),
});
export type AmendCostInput = z.infer<typeof amendCostSchema>;

export const deleteProjectSchema = z.object({
  confirmName: z.string().min(1, "Type the candidate name to confirm."),
});

export const reopenSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to reopen."),
});

export const campaignContactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required.").max(200),
  email: z.email("Enter a valid contact email."),
  phone: z.string().trim().max(50).optional(),
});

export const createAdminSchema = z.object({
  email: z.email("Enter a valid email address."),
  name: z.string().trim().min(1, "Name is required.").max(200),
  isSuperuser: z.boolean().default(false),
});
