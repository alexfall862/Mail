/**
 * Pure helpers for the version validity rule and the resubmission routing
 * rule's artwork comparison (SPEC §5–6). No I/O — unit tested directly.
 */
import { ARTWORK_KINDS, type UploadKind } from "./uploads";

export type ValidityResult = { ok: true } | { ok: false; message: string };

/**
 * §6 version validity rule, enforced server-side on every submission: artwork
 * present as either (front AND back) or (combined) — never both sets, never a
 * partial set — plus exactly one invoice (every version is self-contained).
 */
export function validateVersionFileSet(kinds: UploadKind[]): ValidityResult {
  if (new Set(kinds).size !== kinds.length) {
    return { ok: false, message: "Duplicate file slots in submission." };
  }
  const has = (k: UploadKind) => kinds.includes(k);
  const separate = has("artwork_front") || has("artwork_back");
  const combined = has("artwork_combined");

  if (separate && combined) {
    return {
      ok: false,
      message:
        "Artwork must be either separate front/back files or one combined file, not both.",
    };
  }
  if (separate && (!has("artwork_front") || !has("artwork_back"))) {
    return {
      ok: false,
      message: "Both a front and a back artwork file are required.",
    };
  }
  if (!separate && !combined) {
    return { ok: false, message: "Artwork is required." };
  }
  if (!has("invoice")) {
    return { ok: false, message: "An invoice is required." };
  }
  return { ok: true };
}

/**
 * Routing-rule input (§5, transition 7): did ANY artwork file change between
 * versions? Compares the artwork slots by R2 key — carry-forward reuses the
 * old key, so a differing or added/removed key means changed artwork. This
 * also catches switching between separate and combined modes.
 */
export function computeArtworkChanged(
  previous: Partial<Record<UploadKind, string>>,
  next: Partial<Record<UploadKind, string>>,
): boolean {
  return ARTWORK_KINDS.some((kind) => previous[kind] !== next[kind]);
}
