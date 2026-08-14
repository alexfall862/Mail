/**
 * Advisory AI pre-check panel (server component). Renders the latest
 * ai_review event; every flag is framed as "verify this yourself" — the
 * pre-check never decides anything.
 */
import { formatDateTime } from "@/lib/format";
import type { AiReviewResult } from "@/lib/ai-review";
import { AiReviewRunButton } from "./actions";

export type AiReviewEventView =
  | {
      kind: "completed";
      at: Date;
      versionNumber: number | null;
      flagCount: number;
      result: AiReviewResult;
    }
  | { kind: "failed"; at: Date; error: string }
  | null;

function searchUrl(citation: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(citation)}`;
}

export function AiReviewPanel({
  projectId,
  latest,
  canRun,
}: {
  projectId: string;
  latest: AiReviewEventView;
  canRun: boolean;
}) {
  return (
    <section className="rounded-lg border border-purple-200 bg-purple-50/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            AI pre-check{" "}
            <span className="align-middle text-xs font-normal text-purple-700">
              advisory only: verify every flag yourself
            </span>
          </h2>
          {latest?.kind === "completed" && (
            <p className="mt-0.5 text-xs text-gray-600">
              Ran {formatDateTime(latest.at)}
              {latest.versionNumber ? ` on version ${latest.versionNumber}` : ""} ·{" "}
              {latest.flagCount === 0
                ? "nothing flagged"
                : `${latest.flagCount} item${latest.flagCount === 1 ? "" : "s"} to check`}
            </p>
          )}
        </div>
        {canRun && <AiReviewRunButton projectId={projectId} />}
      </div>

      {latest === null && (
        <p className="mt-3 text-sm text-gray-600">
          No AI pre-check has run yet for this project.
        </p>
      )}

      {latest?.kind === "failed" && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
          The last AI pre-check failed: {latest.error}
        </p>
      )}

      {latest?.kind === "completed" && (
        <div className="mt-4 space-y-4 text-sm">
          {/* Disclaimer */}
          <div>
            <p className="font-medium text-gray-900">
              &quot;Paid for by&quot; disclaimer
            </p>
            {latest.result.disclaimer.found ? (
              latest.result.disclaimer.matches_kdp ? (
                <p className="mt-1 rounded-md bg-green-50 p-2 text-green-800">
                  ✓ Found, attributed to the Kansas Democratic Party:{" "}
                  <span className="italic">
                    &quot;{latest.result.disclaimer.text}&quot;
                  </span>
                </p>
              ) : (
                <p className="mt-1 rounded-md bg-amber-50 p-2 text-amber-900">
                  ⚠ Found, but may not be the Kansas Democratic Party:{" "}
                  <span className="italic">
                    &quot;{latest.result.disclaimer.text}&quot;
                  </span>
                  {latest.result.disclaimer.concern && (
                    <> · {latest.result.disclaimer.concern}</>
                  )}
                </p>
              )
            ) : (
              <p className="mt-1 rounded-md bg-red-50 p-2 text-red-800">
                ✗ No disclaimer detected. Verify manually before advancing.
                {latest.result.disclaimer.concern && (
                  <> · {latest.result.disclaimer.concern}</>
                )}
              </p>
            )}
          </div>

          {/* Claims & citations */}
          <div>
            <p className="font-medium text-gray-900">Claims &amp; citations</p>
            {latest.result.claims.length === 0 ? (
              <p className="mt-1 text-gray-600">
                No factual claims detected in the copy.
              </p>
            ) : (
              <ul className="mt-1 space-y-2">
                {latest.result.claims.map((claim, i) => (
                  <li
                    key={i}
                    className={`rounded-md p-2 ${claim.has_citation ? "bg-white" : "bg-amber-50"}`}
                  >
                    <p className="text-gray-900">&quot;{claim.claim}&quot;</p>
                    {claim.has_citation && claim.citation ? (
                      <p className="mt-0.5 text-xs text-gray-600">
                        Cited: <span className="italic">{claim.citation}</span>{" "}
                        <a
                          href={searchUrl(claim.citation)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 underline"
                        >
                          Search this source
                        </a>
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs font-medium text-amber-800">
                        ⚠ No citation visible for this claim.
                      </p>
                    )}
                    {claim.note && (
                      <p className="mt-0.5 text-xs text-gray-500">{claim.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Spelling & grammar */}
          <div>
            <p className="font-medium text-gray-900">Spelling &amp; grammar</p>
            {latest.result.spelling_grammar.length === 0 ? (
              <p className="mt-1 text-gray-600">Nothing flagged.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {latest.result.spelling_grammar.map((item, i) => (
                  <li key={i} className="rounded-md bg-amber-50 p-2">
                    <span className="italic">&quot;{item.text}&quot;</span>: {item.issue}
                    {item.suggestion && (
                      <span className="text-gray-600">
                        {" "}
                        (suggestion: {item.suggestion})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {latest.result.overall_notes && (
            <p className="rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-600">
              Model notes: {latest.result.overall_notes}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
