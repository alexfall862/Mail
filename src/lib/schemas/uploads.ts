/** Presign request schema, shared client/server (SPEC §6). */
import { z } from "zod";
import { FILE_KINDS } from "@/lib/uploads";

export const presignAuthSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    // First call: Turnstile token (verified, then a draft token is issued).
    // Subsequent calls in the same form session: the draft token.
    turnstileToken: z.string().optional(),
    draftToken: z.string().optional(),
  }),
  z.object({
    mode: z.literal("resubmit"),
    vendorToken: z.string().min(1),
  }),
]);

export const presignRequestSchema = z.object({
  kind: z.enum(FILE_KINDS),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  auth: presignAuthSchema,
});
export type PresignRequest = z.infer<typeof presignRequestSchema>;

export type PresignResponse = {
  url: string;
  key: string;
  /** Present on the first call of a new-submission flow. */
  draftToken?: string;
};
