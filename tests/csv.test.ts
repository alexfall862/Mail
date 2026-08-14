import { describe, expect, it } from "vitest";
import { buildCsv, csvEscape } from "@/lib/csv";

describe("CSV building (§11)", () => {
  it("starts with a UTF-8 BOM", () => {
    const csv = buildCsv(["a"], [["b"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("quotes fields containing commas, quotes, and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("uses CRLF row endings", () => {
    const csv = buildCsv(["h1", "h2"], [["v1", "v2"]]);
    expect(csv).toContain("h1,h2\r\nv1,v2\r\n");
  });
});
