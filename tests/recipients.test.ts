import { describe, expect, it } from "vitest";
import { dedupeRecipients, recipientLists } from "@/lib/email/recipients";

describe("email recipient dedupe", () => {
  it("one contact listed under three vendor roles gets one email", () => {
    const to = ["sam@printco.com", "sam@printco.com", "sam@printco.com"];
    expect(recipientLists(to).to).toEqual(["sam@printco.com"]);
  });

  it("treats case and surrounding whitespace as the same inbox", () => {
    expect(
      dedupeRecipients(["Sam@PrintCo.com", " sam@printco.com ", "SAM@PRINTCO.COM"]),
    ).toEqual(["sam@printco.com"]);
  });

  it("keeps distinct contacts in first-seen order and drops blanks", () => {
    expect(dedupeRecipients(["b@x.com", "", "a@x.com", "b@x.com"])).toEqual([
      "b@x.com",
      "a@x.com",
    ]);
  });

  it("drops anyone already in To from CC, case-insensitively", () => {
    const { to, cc } = recipientLists(
      ["vendor@x.com"],
      ["Admin@kdp.org", "VENDOR@x.com", "admin@kdp.org"],
    );
    expect(to).toEqual(["vendor@x.com"]);
    expect(cc).toEqual(["admin@kdp.org"]);
  });

  it("defaults CC to empty", () => {
    expect(recipientLists(["a@x.com"]).cc).toEqual([]);
  });
});
