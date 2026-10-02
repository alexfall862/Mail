import { describe, expect, it } from "vitest";
import type { DashboardPayment, DashboardRow } from "@/lib/admin-ops";
import {
  buildCheckRegister,
  normalizeCheckNumber,
  parseDollarsToCents,
  summarizePayments,
} from "@/lib/payments";

function payment(over: Partial<DashboardPayment> & { contactId: string }): DashboardPayment {
  return {
    role: "print_shop",
    orgName: `Org ${over.contactId}`,
    paidAt: null,
    checkNumber: null,
    amountCents: null,
    ...over,
  };
}

function row(
  id: string,
  payments: DashboardPayment[],
  over: Partial<DashboardRow> = {},
): DashboardRow {
  return {
    id,
    candidateSupported: `Candidate ${id}`,
    office: "state_house",
    status: "approved",
    changesRequestedFrom: null,
    mailDate: "2030-01-15",
    pieceCount: 1000,
    totalCostCents: 50_000,
    paidNeeded: payments.length,
    paidDone: payments.filter((p) => p.paidAt).length,
    payments,
    reviewRequests: [],
    ...over,
  };
}

describe("check register", () => {
  it("groups paid vendors by check number, case- and whitespace-insensitively", () => {
    const rows = [
      row("a", [
        payment({ contactId: "a1", paidAt: "2026-09-01T12:00:00.000Z", checkNumber: "1001", amountCents: 10_000 }),
      ]),
      row("b", [
        payment({ contactId: "b1", paidAt: "2026-09-02T12:00:00.000Z", checkNumber: " 1001 ", amountCents: 5_000 }),
        payment({ contactId: "b2", role: "mail_house", paidAt: "2026-09-03T12:00:00.000Z", checkNumber: "1002", amountCents: 2_500 }),
      ]),
      row("c", [payment({ contactId: "c1" })]), // unpaid: never appears
    ];
    const register = buildCheckRegister(rows);
    expect(register.map((e) => e.checkNumber)).toEqual(["1002", "1001"]); // newest first
    const c1001 = register.find((e) => e.checkNumber === "1001")!;
    expect(c1001.payments.map((p) => p.projectId)).toEqual(["a", "b"]);
    expect(c1001.amountCents).toBe(15_000);
    expect(c1001.firstPaidAt).toBe("2026-09-01T12:00:00.000Z");
    expect(c1001.missingAmounts).toBe(0);
  });

  it("keeps payments recorded without a check number in a trailing group", () => {
    const rows = [
      row("a", [payment({ contactId: "a1", paidAt: "2026-09-05T00:00:00.000Z" })]),
      row("b", [
        payment({ contactId: "b1", paidAt: "2026-09-01T00:00:00.000Z", checkNumber: "7", amountCents: 100 }),
        payment({ contactId: "b2", paidAt: "2026-09-01T00:00:00.000Z", checkNumber: "7" }),
      ]),
    ];
    const register = buildCheckRegister(rows);
    expect(register.map((e) => e.checkNumber)).toEqual(["7", null]);
    expect(register[0]!.amountCents).toBe(100);
    expect(register[0]!.missingAmounts).toBe(1);
    expect(register[1]!.amountCents).toBeNull();
    expect(register[1]!.payments).toHaveLength(1);
  });

  it("returns nothing when no payment has been recorded", () => {
    expect(buildCheckRegister([row("a", [payment({ contactId: "a1" })])])).toEqual([]);
    expect(buildCheckRegister([])).toEqual([]);
  });
});

describe("payment summary", () => {
  it("counts approved billable/fully-paid projects, outstanding vendors, and checks", () => {
    const rows = [
      row("a", [
        payment({ contactId: "a1", paidAt: "2026-09-01T00:00:00.000Z", checkNumber: "1" }),
        payment({ contactId: "a2" }),
      ]),
      row("b", [payment({ contactId: "b1", paidAt: "2026-09-01T00:00:00.000Z", checkNumber: "1" })]),
      row("c", []), // approved, nothing owed to anyone
      row("d", [payment({ contactId: "d1", paidAt: "2026-09-01T00:00:00.000Z" })], {
        status: "legal_review",
      }),
    ];
    expect(summarizePayments(rows)).toEqual({
      approvedBillable: 2,
      approvedFullyPaid: 1,
      vendorsAwaiting: 1,
      checksRecorded: 1,
      paidWithoutCheck: 1,
    });
  });
});

describe("helpers", () => {
  it("normalizes check numbers", () => {
    expect(normalizeCheckNumber("  ab 12 ")).toBe("AB 12");
    expect(normalizeCheckNumber("")).toBeNull();
    expect(normalizeCheckNumber(null)).toBeNull();
  });

  it("parses dollar strings into cents", () => {
    expect(parseDollarsToCents("1,234.50")).toBe(123_450);
    expect(parseDollarsToCents("$1234")).toBe(123_400);
    expect(parseDollarsToCents("0.5")).toBe(50);
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("   ")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeUndefined();
    expect(parseDollarsToCents("abc")).toBeUndefined();
    expect(parseDollarsToCents("-5")).toBeUndefined();
  });
});
