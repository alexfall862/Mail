/**
 * Recipient normalization (2026-10-01). Vendors routinely list the same
 * person as designer, print shop, and mail house; a status email must still
 * reach that inbox once. Every send runs its To/CC lists through here so the
 * guarantee doesn't depend on which caller built the lists or whether the
 * source rows were lowercased.
 */

export function normalizeRecipient(email: string): string {
  return email.trim().toLowerCase();
}

/** Lowercase, trim, drop blanks, keep first occurrence order. */
export function dedupeRecipients(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = normalizeRecipient(raw);
    if (email === "" || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/**
 * Final To and CC lists for one send: each deduped, and anyone already in
 * To is dropped from CC so no inbox gets the same message twice.
 */
export function recipientLists(
  to: readonly string[],
  cc: readonly string[] = [],
): { to: string[]; cc: string[] } {
  const toList = dedupeRecipients(to);
  const toSet = new Set(toList);
  return {
    to: toList,
    cc: dedupeRecipients(cc).filter((e) => !toSet.has(e)),
  };
}
