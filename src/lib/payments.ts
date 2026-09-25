/**
 * Payment aggregation for the admin dashboard (SPEC §8 "paid badge", extended
 * 2026-09-25 with check reconciliation). Pure functions over dashboard rows:
 * no I/O, so the check register and summary are unit-testable and the page
 * needs no extra query beyond the rows it already loads.
 */
import type { DashboardPayment, DashboardRow } from "./admin-ops";

/** One line of the check register: a check and everything it covered. */
export type CheckRegisterEntry = {
  /** Check number as entered, or null for payments recorded without one. */
  checkNumber: string | null;
  /** Earliest paid_at among the payments on this check (ISO). */
  firstPaidAt: string;
  payments: Array<
    DashboardPayment & {
      projectId: string;
      candidateSupported: string;
      projectStatus: DashboardRow["status"];
      projectTotalCostCents: number;
    }
  >;
  /** Sum of the recorded amounts; null when no payment on the check has one. */
  amountCents: number | null;
  /** How many payments on this check lack a recorded amount. */
  missingAmounts: number;
};

/** Trim and collapse a user-entered check number for grouping. Checks are
 * compared case-insensitively with surrounding whitespace ignored, but the
 * first spelling seen is what the register displays. */
export function normalizeCheckNumber(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  return trimmed === "" ? null : trimmed.replace(/\s+/g, " ").toUpperCase();
}

/**
 * Group every recorded payment by check number, newest check first (by the
 * date its first payment was recorded). Payments marked paid without a check
 * number land in one trailing "no check" entry so nothing disappears from
 * the reconciliation view.
 */
export function buildCheckRegister(rows: DashboardRow[]): CheckRegisterEntry[] {
  const groups = new Map<string, CheckRegisterEntry>();
  const NO_CHECK = "\u0000none";
  for (const row of rows) {
    for (const p of row.payments) {
      if (!p.paidAt) continue;
      const key = normalizeCheckNumber(p.checkNumber) ?? NO_CHECK;
      const entry = groups.get(key) ?? {
        checkNumber: key === NO_CHECK ? null : p.checkNumber!.trim(),
        firstPaidAt: p.paidAt,
        payments: [],
        amountCents: null,
        missingAmounts: 0,
      };
      entry.payments.push({
        ...p,
        projectId: row.id,
        candidateSupported: row.candidateSupported,
        projectStatus: row.status,
        projectTotalCostCents: row.totalCostCents,
      });
      if (p.paidAt < entry.firstPaidAt) entry.firstPaidAt = p.paidAt;
      if (p.amountCents === null) entry.missingAmounts += 1;
      else entry.amountCents = (entry.amountCents ?? 0) + p.amountCents;
      groups.set(key, entry);
    }
  }
  const entries = [...groups.values()];
  for (const e of entries) {
    e.payments.sort((a, b) => a.candidateSupported.localeCompare(b.candidateSupported));
  }
  return entries.sort((a, b) => {
    if (a.checkNumber === null) return 1;
    if (b.checkNumber === null) return -1;
    return b.firstPaidAt.localeCompare(a.firstPaidAt) || a.checkNumber.localeCompare(b.checkNumber);
  });
}

export type PaymentSummary = {
  /** Approved projects with at least one KDP-payable vendor. */
  approvedBillable: number;
  /** Approved projects where every KDP-payable vendor is paid. */
  approvedFullyPaid: number;
  /** Individual vendor payments still owed on approved projects. */
  vendorsAwaiting: number;
  /** Distinct check numbers recorded across all projects. */
  checksRecorded: number;
  /** Payments recorded (any status) without a check number. */
  paidWithoutCheck: number;
};

/** Headline counts for the dashboard's payments strip. */
export function summarizePayments(rows: DashboardRow[]): PaymentSummary {
  const checks = new Set<string>();
  let paidWithoutCheck = 0;
  for (const row of rows) {
    for (const p of row.payments) {
      if (!p.paidAt) continue;
      const key = normalizeCheckNumber(p.checkNumber);
      if (key) checks.add(key);
      else paidWithoutCheck += 1;
    }
  }
  const approved = rows.filter((r) => r.status === "approved" && r.paidNeeded > 0);
  return {
    approvedBillable: approved.length,
    approvedFullyPaid: approved.filter((r) => r.paidDone === r.paidNeeded).length,
    vendorsAwaiting: approved.reduce((n, r) => n + (r.paidNeeded - r.paidDone), 0),
    checksRecorded: checks.size,
    paidWithoutCheck,
  };
}

/**
 * Parse a dollars string from a form field ("1,234.50", "$1234", "") into
 * cents. Returns null for blank, undefined when the text isn't a money amount.
 */
export function parseDollarsToCents(raw: string): number | null | undefined {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
