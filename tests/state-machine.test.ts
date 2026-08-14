/**
 * Exhaustive tests for the §5 state machine:
 *  - every row of the transition table,
 *  - both branches of the resubmission routing rule,
 *  - the one-decision-per-stage rule,
 *  - rejection of every disallowed transition (full enumeration).
 */
import { describe, expect, it } from "vitest";
import {
  CREATED_STATUS,
  POST_CREATION_STATUS,
  PROJECT_STATUSES,
  REVIEW_DECISIONS,
  REVIEW_STAGES,
  transition,
  type ProjectState,
  type ProjectStatus,
  type ReviewStage,
  type TransitionInput,
} from "@/lib/state-machine";

const state = (
  status: ProjectStatus,
  changesRequestedFrom: ProjectStatus | null = null,
): ProjectState => ({ status, changesRequestedFrom });

function expectOk(result: ReturnType<typeof transition>): ProjectState {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.message}`);
  return result.state;
}

describe("creation (§5 rows 1–2)", () => {
  it("projects are created as 'submitted'", () => {
    expect(CREATED_STATUS).toBe("submitted");
  });

  it("row 2: submitted → content_review via automatic system advance", () => {
    const next = expectOk(
      transition(state("submitted"), { kind: "system_advance_after_creation" }),
    );
    expect(next).toEqual({
      status: "content_review",
      changesRequestedFrom: null,
    });
    expect(POST_CREATION_STATUS).toBe("content_review");
  });

  it("system advance is rejected from every other status", () => {
    for (const s of PROJECT_STATUSES) {
      if (s === "submitted") continue;
      const result = transition(state(s), {
        kind: "system_advance_after_creation",
      });
      expect(result.ok, `system advance from ${s} must fail`).toBe(false);
    }
  });
});

describe("advance decisions (§5 rows 3–5)", () => {
  const expected: Array<[ReviewStage, ProjectStatus]> = [
    ["content_review", "legal_review"], // row 3
    ["legal_review", "final_review"], // row 4
    ["final_review", "approved"], // row 5
  ];

  for (const [stage, target] of expected) {
    it(`${stage} --advanced--> ${target}`, () => {
      const next = expectOk(
        transition(state(stage), {
          kind: "review_decision",
          stage,
          decision: "advanced",
        }),
      );
      expect(next).toEqual({ status: target, changesRequestedFrom: null });
    });
  }
});

describe("changes requested (§5 row 6)", () => {
  for (const stage of REVIEW_STAGES) {
    it(`${stage} --changes_requested--> changes_requested, recording the stage`, () => {
      const next = expectOk(
        transition(state(stage), {
          kind: "review_decision",
          stage,
          decision: "changes_requested",
        }),
      );
      expect(next).toEqual({
        status: "changes_requested",
        changesRequestedFrom: stage,
      });
    });
  }
});

describe("denial (§5 row 8)", () => {
  for (const stage of REVIEW_STAGES) {
    it(`${stage} --denied--> denied`, () => {
      const next = expectOk(
        transition(state(stage), {
          kind: "review_decision",
          stage,
          decision: "denied",
        }),
      );
      expect(next).toEqual({ status: "denied", changesRequestedFrom: null });
    });
  }
});

describe("resubmission routing rule (§5 row 7) — both branches", () => {
  for (const from of REVIEW_STAGES) {
    it(`artwork changed, kicked back from ${from} → content_review`, () => {
      const next = expectOk(
        transition(state("changes_requested", from), {
          kind: "vendor_resubmit",
          artworkChanged: true,
        }),
      );
      expect(next).toEqual({
        status: "content_review",
        changesRequestedFrom: null,
      });
    });

    it(`only non-artwork changed, kicked back from ${from} → back to ${from}`, () => {
      const next = expectOk(
        transition(state("changes_requested", from), {
          kind: "vendor_resubmit",
          artworkChanged: false,
        }),
      );
      expect(next).toEqual({ status: from, changesRequestedFrom: null });
    });
  }

  it("resubmission clears changes_requested_from in both branches", () => {
    for (const artworkChanged of [true, false]) {
      const result = transition(state("changes_requested", "legal_review"), {
        kind: "vendor_resubmit",
        artworkChanged,
      });
      expect(expectOk(result).changesRequestedFrom).toBeNull();
    }
  });

  it("rejects resubmission from every status except changes_requested", () => {
    for (const s of PROJECT_STATUSES) {
      if (s === "changes_requested") continue;
      for (const artworkChanged of [true, false]) {
        const result = transition(state(s), {
          kind: "vendor_resubmit",
          artworkChanged,
        });
        expect(result.ok, `resubmit from ${s} must fail`).toBe(false);
      }
    }
  });

  it("rejects resubmission when the stored originating stage is missing or invalid", () => {
    for (const bad of [
      null,
      "submitted",
      "approved",
      "denied",
      "changes_requested",
    ] as const) {
      const result = transition(state("changes_requested", bad), {
        kind: "vendor_resubmit",
        artworkChanged: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_state");
    }
  });
});

describe("superuser reopen (§5 row 10)", () => {
  for (const s of ["approved", "denied"] as const) {
    it(`${s} → final_review with superuser + reason`, () => {
      const next = expectOk(
        transition(state(s), {
          kind: "superuser_reopen",
          actorIsSuperuser: true,
          reason: "Printed proofs revealed a disclaimer problem.",
        }),
      );
      expect(next).toEqual({
        status: "final_review",
        changesRequestedFrom: null,
      });
    });
  }

  it("rejects reopen by a non-superuser", () => {
    const result = transition(state("approved"), {
      kind: "superuser_reopen",
      actorIsSuperuser: false,
      reason: "valid reason",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_superuser");
  });

  it("rejects reopen without a reason (empty or whitespace)", () => {
    for (const reason of ["", "   ", "\n\t"]) {
      const result = transition(state("denied"), {
        kind: "superuser_reopen",
        actorIsSuperuser: true,
        reason,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("reason_required");
    }
  });

  it("rejects reopen from every non-terminal status", () => {
    for (const s of PROJECT_STATUSES) {
      if (s === "approved" || s === "denied") continue;
      const result = transition(state(s), {
        kind: "superuser_reopen",
        actorIsSuperuser: true,
        reason: "valid reason",
      });
      expect(result.ok, `reopen from ${s} must fail`).toBe(false);
    }
  });
});

describe("one decision per stage (§5 guardrails)", () => {
  it("a second decision at the same stage is rejected after the first lands", () => {
    for (const stage of REVIEW_STAGES) {
      for (const first of REVIEW_DECISIONS) {
        const afterFirst = expectOk(
          transition(state(stage), {
            kind: "review_decision",
            stage,
            decision: first,
          }),
        );
        for (const second of REVIEW_DECISIONS) {
          const result = transition(afterFirst, {
            kind: "review_decision",
            stage,
            decision: second,
          });
          expect(
            result.ok,
            `second decision (${second}) after ${first} at ${stage} must fail`,
          ).toBe(false);
          if (!result.ok) {
            expect(result.message).toMatch(/already moved to/);
          }
        }
      }
    }
  });

  it("decisions for a stage other than the current one are rejected (stale click)", () => {
    for (const s of PROJECT_STATUSES) {
      for (const stage of REVIEW_STAGES) {
        if (s === stage) continue;
        for (const decision of REVIEW_DECISIONS) {
          const result = transition(state(s), {
            kind: "review_decision",
            stage,
            decision,
          });
          expect(result.ok, `${decision}@${stage} from ${s} must fail`).toBe(
            false,
          );
          if (!result.ok) {
            expect(result.message).toMatch(/already moved to/);
          }
        }
      }
    }
  });
});

describe("whitelist exhaustiveness — no undeclared (from → to) edge is reachable", () => {
  // Every status transition §5 allows, as from→to edges. Nothing else may
  // ever come out of `transition` with ok: true.
  const allowedEdges = new Set([
    "submitted→content_review", // row 2
    "content_review→legal_review", // row 3
    "legal_review→final_review", // row 4
    "final_review→approved", // row 5
    "content_review→changes_requested", // row 6
    "legal_review→changes_requested",
    "final_review→changes_requested",
    "changes_requested→content_review", // row 7 (artwork branch + non-artwork from content)
    "changes_requested→legal_review", // row 7 (non-artwork branch)
    "changes_requested→final_review", // row 7 (non-artwork branch)
    "content_review→denied", // row 8
    "legal_review→denied",
    "final_review→denied",
    "approved→final_review", // row 10
    "denied→final_review", // row 10
  ]);

  it("enumerating every (state × input) yields exactly the §5 edges", () => {
    const inputs: TransitionInput[] = [
      { kind: "system_advance_after_creation" },
      ...REVIEW_STAGES.flatMap((stage) =>
        REVIEW_DECISIONS.map(
          (decision): TransitionInput => ({
            kind: "review_decision",
            stage,
            decision,
          }),
        ),
      ),
      { kind: "vendor_resubmit", artworkChanged: true },
      { kind: "vendor_resubmit", artworkChanged: false },
      {
        kind: "superuser_reopen",
        actorIsSuperuser: true,
        reason: "valid reason",
      },
    ];

    const reached = new Set<string>();
    for (const status of PROJECT_STATUSES) {
      for (const from of [null, ...REVIEW_STAGES]) {
        for (const input of inputs) {
          const result = transition(state(status, from), input);
          if (result.ok) {
            reached.add(`${status}→${result.state.status}`);
            // Sanity: the invariant holds on every successful transition.
            if (result.state.status !== "changes_requested") {
              expect(result.state.changesRequestedFrom).toBeNull();
            }
          }
        }
      }
    }
    expect(reached).toEqual(allowedEdges);
  });
});
