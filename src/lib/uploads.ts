/**
 * Upload validation shared by the presign endpoint and the final-submit
 * HEAD-verification (SPEC §6). Artwork reaching R2 is always the client
 * pipeline's JPEG output; invoices are stored as-is.
 */
import { headObject } from "./r2";

export const FILE_KINDS = [
  "artwork_front",
  "artwork_back",
  "artwork_combined",
  "invoice",
] as const;
export type UploadKind = (typeof FILE_KINDS)[number];

export const ARTWORK_KINDS = [
  "artwork_front",
  "artwork_back",
  "artwork_combined",
] as const;
export type ArtworkKind = (typeof ARTWORK_KINDS)[number];

export function isArtworkKind(kind: UploadKind): kind is ArtworkKind {
  return kind !== "invoice";
}

export const MAX_ARTWORK_BYTES = 8 * 1024 * 1024; // §6 backstop
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/** Content types allowed AT REST (post-processing), enforced at presign. */
export const ALLOWED_CONTENT_TYPES: Record<UploadKind, readonly string[]> = {
  artwork_front: ["image/jpeg"],
  artwork_back: ["image/jpeg"],
  artwork_combined: ["image/jpeg"],
  invoice: ["application/pdf", "image/jpeg", "image/png"],
};

export function maxBytesFor(kind: UploadKind): number {
  return isArtworkKind(kind) ? MAX_ARTWORK_BYTES : MAX_INVOICE_BYTES;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/** §6 key convention: projects/{project_id}/v{version_number}/{kind}.{ext} */
export function buildR2Key(
  projectId: string,
  versionNumber: number,
  kind: UploadKind,
  contentType: string,
): string {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new Error(`No extension mapping for ${contentType}`);
  return `projects/${projectId}/v${versionNumber}/${kind}.${ext}`;
}

export type PresignValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validatePresignRequest(
  kind: UploadKind,
  contentType: string,
  sizeBytes: number,
): PresignValidation {
  if (!ALLOWED_CONTENT_TYPES[kind].includes(contentType)) {
    return {
      ok: false,
      message: isArtworkKind(kind)
        ? "Artwork uploads must be the processed JPEG produced by this form."
        : "Invoices must be a PDF, JPEG, or PNG file.",
    };
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, message: "Invalid file size." };
  }
  if (sizeBytes > maxBytesFor(kind)) {
    const mb = Math.round(maxBytesFor(kind) / 1024 / 1024);
    return { ok: false, message: `File is too large (limit ${mb} MB).` };
  }
  return { ok: true };
}

export type ClaimedFile = {
  kind: UploadKind;
  r2Key: string;
  sizeBytes: number;
  contentType: string;
};

export type HeadVerification =
  | { ok: true }
  | { ok: false; message: string };

/**
 * §6 "never trust the client": before creating files rows, HEAD each claimed
 * key to confirm it exists in R2 with the claimed size/content-type, within
 * caps, and under the expected project prefix.
 */
export async function verifyClaimedFile(
  file: ClaimedFile,
  expectedProjectId: string,
): Promise<HeadVerification> {
  if (!file.r2Key.startsWith(`projects/${expectedProjectId}/`)) {
    return { ok: false, message: "Uploaded file key does not match this project." };
  }
  const head = await headObject(file.r2Key);
  if (!head.exists) {
    return {
      ok: false,
      message:
        "An uploaded file could not be found in storage. Its upload may have expired. Please re-attach it and try again.",
    };
  }
  if (head.sizeBytes !== file.sizeBytes || head.sizeBytes > maxBytesFor(file.kind)) {
    return { ok: false, message: "Uploaded file size does not match." };
  }
  if (
    head.contentType !== file.contentType ||
    !ALLOWED_CONTENT_TYPES[file.kind].includes(head.contentType ?? "")
  ) {
    return { ok: false, message: "Uploaded file type does not match." };
  }
  return { ok: true };
}
