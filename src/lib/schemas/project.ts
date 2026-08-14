/**
 * Submission form schemas and option lists (SPEC §9), shared client/server.
 * Kept free of database imports so client bundles stay lean.
 */
import { z } from "zod";
import { FILE_KINDS } from "@/lib/uploads";

export const OFFICES = [
  { value: "us_senate", label: "U.S. Senate" },
  { value: "governor", label: "Governor" },
  { value: "secretary_of_state", label: "Secretary of State" },
  { value: "attorney_general", label: "Attorney General" },
  { value: "state_treasurer", label: "State Treasurer" },
  { value: "insurance_commissioner", label: "Insurance Commissioner" },
  { value: "state_board_of_education", label: "State Board of Education" },
  { value: "state_senate", label: "State Senate" },
  { value: "state_house", label: "State House" },
  { value: "county_party", label: "County Party" },
  { value: "municipal_county_office", label: "Municipal / County Office" },
  { value: "other", label: "Other" },
] as const;

export const OFFICE_VALUES = OFFICES.map((o) => o.value) as [
  (typeof OFFICES)[number]["value"],
  ...(typeof OFFICES)[number]["value"][],
];
export type Office = (typeof OFFICE_VALUES)[number];

export function officeLabel(value: Office): string {
  return OFFICES.find((o) => o.value === value)?.label ?? value;
}

/** §9: offices where district_detail is required. */
export const DISTRICT_REQUIRED_OFFICES: readonly Office[] = [
  "state_senate",
  "state_house",
  "county_party",
  "municipal_county_office",
  "other",
];

export const DISTRICT_DETAIL_LABEL = "District";

export const DISTRICT_TOOLTIP =
  'What to enter: statewide races use "Statewide". State Board of Education, ' +
  "State Senate, and State House use the district number. County Party uses " +
  "the county name. For municipal or other offices, describe the district, " +
  "county, or office.";

export const VENDOR_ROLES = [
  { value: "designer_consultant", label: "Designer / Consultant" },
  { value: "print_shop", label: "Print Shop" },
  { value: "mail_house", label: "Mail House" },
] as const;
export const VENDOR_ROLE_VALUES = VENDOR_ROLES.map((r) => r.value) as [
  (typeof VENDOR_ROLES)[number]["value"],
  ...(typeof VENDOR_ROLES)[number]["value"][],
];
export type VendorRole = (typeof VENDOR_ROLE_VALUES)[number];

export function vendorRoleLabel(value: VendorRole): string {
  return VENDOR_ROLES.find((r) => r.value === value)?.label ?? value;
}

/** Kansas's timezone anchors "today" for the mail-date rule. */
export function todayInKansas(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/**
 * Earliest allowed mail date: two full business days (Mon-Fri, holidays not
 * counted) after today. E.g. Monday → Wednesday, Friday → Tuesday.
 */
export function minMailDate(today: string = todayInKansas()): string {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  let businessDays = 0;
  while (businessDays < 2) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) businessDays++;
  }
  return date.toISOString().slice(0, 10);
}

const baseProjectFields = z.object({
    candidateSupported: z
      .string()
      .trim()
      .min(1, "Candidate or cause supported is required.")
      .max(200),
    description: z.string().trim().min(1, "Description is required.").max(5000),
    office: z.enum(OFFICE_VALUES),
    districtDetail: z.string().trim().max(300).optional(),
    pieceCount: z
      .number()
      .int("Piece count must be a whole number.")
      .positive("Piece count must be greater than zero."),
    totalCostCents: z
      .number()
      .int()
      .min(0, "Total cost can't be negative.")
      .max(1_000_000_000_00, "Total cost looks too large."),
    postOfficeLocation: z
      .string()
      .trim()
      .min(1, "Post office location is required.")
      .max(300),
    permitNumber: z.string().trim().min(1, "Permit number is required.").max(100),
    mailDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid mail date."),
    // Campaign contact fields are deliberately absent: that's admin-side data
    // set on the ticket (with known-roster suggestions), not vendor intake.
  });

function refineProjectFields(
  data: { office: Office; districtDetail?: string; mailDate: string },
  ctx: z.RefinementCtx,
): void {
  if (
    DISTRICT_REQUIRED_OFFICES.includes(data.office) &&
    !data.districtDetail?.trim()
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["districtDetail"],
      message: `${DISTRICT_DETAIL_LABEL} is required for this office.`,
    });
  }
  if (data.mailDate < minMailDate()) {
    ctx.addIssue({
      code: "custom",
      path: ["mailDate"],
      message: "Mail date must be at least two full business days from today.",
    });
  }
}

export const projectFieldsSchema = baseProjectFields.superRefine(refineProjectFields);
export type ProjectFields = z.infer<typeof projectFieldsSchema>;

/**
 * Resubmission variant: total cost is optional and the pre-filled form leaves
 * it blank, so the vendor's quoted price never appears on the status page
 * (campaigns get that link). Omitted cost carries the current value forward.
 */
export const resubmitProjectFieldsSchema = baseProjectFields
  .extend({ totalCostCents: baseProjectFields.shape.totalCostCents.optional() })
  .superRefine(refineProjectFields);
export type ResubmitProjectFields = z.infer<typeof resubmitProjectFieldsSchema>;

export const contactSchema = z.object({
  role: z.enum(VENDOR_ROLE_VALUES),
  orgName: z.string().trim().min(1, "Organization name is required.").max(200),
  contactName: z.string().trim().min(1, "Contact name is required.").max(200),
  email: z.email("Enter a valid email address."),
  phone: z.string().trim().max(50).optional(),
  paidByKdp: z.boolean(),
  isPrimary: z.boolean(),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const contactsSchema = z
  .array(contactSchema)
  .min(1, "Complete at least one vendor block.")
  .max(3)
  .superRefine((contacts, ctx) => {
    const roles = contacts.map((c) => c.role);
    if (new Set(roles).size !== roles.length) {
      ctx.addIssue({ code: "custom", message: "Each vendor role can only appear once." });
    }
    if (!contacts.some((c) => c.isPrimary)) {
      ctx.addIssue({
        code: "custom",
        message:
          'At least one contact must be marked "receive status emails".',
      });
    }
  });

export const fileClaimSchema = z.object({
  kind: z.enum(FILE_KINDS),
  r2Key: z.string().min(1).max(500),
  originalFilename: z.string().trim().min(1).max(300),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  widthPx: z.number().int().positive().nullish(),
  heightPx: z.number().int().positive().nullish(),
});
export type FileClaim = z.infer<typeof fileClaimSchema>;

export const submitRequestSchema = z.object({
  draftToken: z.string().min(1),
  project: projectFieldsSchema,
  contacts: contactsSchema,
  files: z.array(fileClaimSchema).min(1).max(4),
});
export type SubmitRequest = z.infer<typeof submitRequestSchema>;

export const resubmitRequestSchema = z.object({
  vendorToken: z.string().min(1),
  project: resubmitProjectFieldsSchema,
  contacts: contactsSchema,
  /** Newly uploaded files for this version. */
  uploads: z.array(fileClaimSchema).max(4),
  /** Slots to carry forward unchanged from the current version. */
  carryForwardKinds: z.array(z.enum(FILE_KINDS)).max(4),
  vendorNote: z.string().trim().max(5000).optional(),
});
export type ResubmitRequest = z.infer<typeof resubmitRequestSchema>;
