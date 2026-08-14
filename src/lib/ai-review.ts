/**
 * AI pre-check (advisory) for newly submitted artwork. Three checks, per the
 * mail program's ask: (1) factual claims should carry citations, transcribed
 * for human click-to-search verification; (2) the "Paid for by" disclaimer
 * exists and attributes the piece to the Kansas Democratic Party;
 * (3) likely spelling/grammar issues.
 *
 * Runs against the review JPEGs via presigned GET URLs handed straight to
 * OpenAI — artwork bytes never transit this server (SPEC §3 preserved).
 * Results land in the events table (ai_review.completed / ai_review.failed)
 * and render as an advisory panel on the admin ticket. Never a gate: humans
 * decide every transition.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { files as filesTable, projects, submissionVersions } from "@/db/schema";
import { logEvent } from "./events";
import { formatDate } from "./format";
import { presignGet } from "./r2";
import { officeLabel, type Office } from "./schemas/project";

const MODEL = "gpt-4.1";
const TIMEOUT_MS = 90_000;

export const aiReviewResultSchema = z.object({
  disclaimer: z.object({
    found: z.boolean(),
    /** Exact transcription when found. */
    text: z.string().nullable(),
    /** True only if it attributes the piece to the Kansas Democratic Party. */
    matches_kdp: z.boolean(),
    concern: z.string().nullable(),
  }),
  claims: z
    .array(
      z.object({
        claim: z.string(),
        has_citation: z.boolean(),
        /** Exact transcription of the cited source when present. */
        citation: z.string().nullable(),
        note: z.string().nullable(),
      }),
    )
    .max(30),
  spelling_grammar: z
    .array(
      z.object({
        text: z.string(),
        issue: z.string(),
        suggestion: z.string().nullable(),
      }),
    )
    .max(30),
  overall_notes: z.string().nullable(),
});
export type AiReviewResult = z.infer<typeof aiReviewResultSchema>;

/** Count of items a human should look at, for compact display. */
export function aiReviewFlagCount(result: AiReviewResult): number {
  const disclaimerFlag =
    !result.disclaimer.found || !result.disclaimer.matches_kdp ? 1 : 0;
  const uncitedClaims = result.claims.filter((c) => !c.has_citation).length;
  return disclaimerFlag + uncitedClaims + result.spelling_grammar.length;
}

/** OpenAI strict structured-output schema mirroring aiReviewResultSchema. */
const RESPONSE_JSON_SCHEMA = {
  name: "mail_precheck",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["disclaimer", "claims", "spelling_grammar", "overall_notes"],
    properties: {
      disclaimer: {
        type: "object",
        additionalProperties: false,
        required: ["found", "text", "matches_kdp", "concern"],
        properties: {
          found: { type: "boolean" },
          text: { type: ["string", "null"] },
          matches_kdp: { type: "boolean" },
          concern: { type: ["string", "null"] },
        },
      },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim", "has_citation", "citation", "note"],
          properties: {
            claim: { type: "string" },
            has_citation: { type: "boolean" },
            citation: { type: ["string", "null"] },
            note: { type: ["string", "null"] },
          },
        },
      },
      spelling_grammar: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "issue", "suggestion"],
          properties: {
            text: { type: "string" },
            issue: { type: "string" },
            suggestion: { type: ["string", "null"] },
          },
        },
      },
      overall_notes: { type: ["string", "null"] },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a pre-check assistant for the Kansas Democratic Party's political mail approval program. You review the front and back artwork of a mail piece BEFORE human reviewers do. Your findings are advisory flags for humans to verify; you never approve or reject anything.

Perform exactly these checks:

1. CLAIMS AND CITATIONS. List each factual claim the piece makes (about a candidate, an opponent, a record, a statistic, or a policy outcome). For each, note whether the artwork visibly cites a source (newspaper name and date, publication, URL, footnote marker with a matching source line). Transcribe any citation EXACTLY as printed so a human can search for it. Slogans, opinions, and pure value statements are not claims.

2. DISCLAIMER. Find the "Paid for by" disclaimer. Transcribe it exactly. Set matches_kdp to true ONLY if it attributes the piece to the Kansas Democratic Party. If it names any other entity, is missing, or is only partially legible, flag that in concern.

3. SPELLING AND GRAMMAR. List likely spelling, grammar, or typographical errors in the visible copy, quoting the text and suggesting a fix.

Be conservative and literal. If text is too small or blurry to read confidently, say so in overall_notes instead of guessing — never report a disclaimer or citation as present unless you can actually read it. Do not fact-check claims; only report whether citations are present.`;

export type AiReviewOutcome =
  | { ok: true; result: AiReviewResult; flagCount: number }
  | { ok: false; message: string };

/**
 * Run the pre-check for a project's current version and record the outcome
 * as an event. Never throws — failures become ai_review.failed events.
 */
export async function runAiReview(
  projectId: string,
  opts: { trigger: "submission" | "manual"; adminId?: string },
): Promise<AiReviewOutcome> {
  const actor = opts.trigger === "manual" ? ("admin" as const) : ("system" as const);
  const fail = async (message: string): Promise<AiReviewOutcome> => {
    console.error(`AI pre-check failed for project ${projectId}: ${message}`);
    await logEvent(db, {
      projectId,
      actor,
      actorId: opts.adminId ?? null,
      eventType: "ai_review.failed",
      payload: { trigger: opts.trigger, error: message },
    }).catch((err) => console.error("Failed to log ai_review.failed:", err));
    return { ok: false, message };
  };

  try {
    if (!process.env.OPENAI_API_KEY) {
      return await fail("OPENAI_API_KEY is not configured");
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project?.currentVersionId) return await fail("Project has no current version");

    const [version] = await db
      .select()
      .from(submissionVersions)
      .where(eq(submissionVersions.id, project.currentVersionId));
    const artwork = (
      await db
        .select()
        .from(filesTable)
        .where(eq(filesTable.versionId, project.currentVersionId))
        .orderBy(desc(filesTable.kind))
    ).filter((f) => f.kind !== "invoice");
    if (artwork.length === 0) return await fail("No artwork on the current version");

    // Presigned GETs: OpenAI fetches directly from R2.
    const imageParts = await Promise.all(
      artwork.map(async (f) => ({
        type: "image_url" as const,
        image_url: { url: await presignGet(f.r2Key), detail: "high" as const },
      })),
    );

    const metadata =
      `Form metadata for cross-reference:\n` +
      `Candidate/cause supported: ${project.candidateSupported}\n` +
      `Office: ${officeLabel(project.office as Office)}` +
      (project.districtDetail ? ` (${project.districtDetail})` : "") +
      `\nScheduled mail date: ${formatDate(project.mailDate)}\n` +
      `Artwork images follow (${artwork.map((f) => f.kind).join(", ")}).`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: "json_schema", json_schema: RESPONSE_JSON_SCHEMA },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [{ type: "text", text: metadata }, ...imageParts],
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return await fail(`OpenAI API error ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return await fail("Empty model response");

    const parsed = aiReviewResultSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return await fail("Model response failed validation");

    const flagCount = aiReviewFlagCount(parsed.data);
    await logEvent(db, {
      projectId,
      actor,
      actorId: opts.adminId ?? null,
      eventType: "ai_review.completed",
      payload: {
        trigger: opts.trigger,
        model: MODEL,
        versionNumber: version?.versionNumber ?? null,
        flagCount,
        result: parsed.data,
      },
    });
    return { ok: true, result: parsed.data, flagCount };
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }
}
