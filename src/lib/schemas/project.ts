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

export const DISTRICT_DETAIL_LABEL = "District / County / Specify office";

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

export const projectFieldsSchema = z
  .object({
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
  })
  .superRefine((data, ctx) => {
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
    if (data.mailDate < todayInKansas()) {
      ctx.addIssue({
        code: "custom",
        path: ["mailDate"],
        message: "Mail date must be today or later.",
      });
    }
  });
export type ProjectFields = z.infer<typeof projectFieldsSchema>;

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
  project: projectFieldsSchema,
  contacts: contactsSchema,
  /** Newly uploaded files for this version. */
  uploads: z.array(fileClaimSchema).max(4),
  /** Slots to carry forward unchanged from the current version. */
  carryForwardKinds: z.array(z.enum(FILE_KINDS)).max(4),
  vendorNote: z.string().trim().max(5000).optional(),
});
export type ResubmitRequest = z.infer<typeof resubmitRequestSchema>;
