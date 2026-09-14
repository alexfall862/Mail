/**
 * Per-project mail threading (production fix, 2026-09-14).
 *
 * Three pieces submitted for the same candidate used to arrive as one chain:
 * every template produced a byte-identical subject and nothing tied a message
 * to its project, so clients grouped them by subject. Reviewers asked to sign
 * off then couldn't tell which piece a message was about.
 *
 * Two things keep a project in its own thread now:
 *   - the project ref in every subject (see SUBJECT_PREFIX in templates.ts),
 *     which is what Outlook-style "conversation topic" threading keys on;
 *   - the References/In-Reply-To anchor below, which is what Gmail and Apple
 *     Mail key on, and which also keeps one project's own emails together.
 */

/**
 * Domain for the synthetic message ids. Any stable domain works — these ids
 * are never delivered to, they only have to be unique and well-formed.
 */
function senderDomain(): string {
  const from = process.env.EMAIL_FROM ?? "";
  return /@([A-Za-z0-9.-]+)/.exec(from)?.[1] ?? "kdp-mail.invalid";
}

/**
 * Headers that pin an email to its project's thread. The anchor names a
 * parent message that was never sent; clients that can't resolve it simply
 * group by the id itself, which is exactly the behaviour we want — same
 * project, same chain; different project, different chain.
 */
export function threadHeaders(
  projectId: string | null,
): Record<string, string> | undefined {
  if (!projectId) return undefined;
  const anchor = `<project-${projectId}@${senderDomain()}>`;
  return { References: anchor, "In-Reply-To": anchor };
}
