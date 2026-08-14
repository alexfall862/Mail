/** Minimal CSV building with Excel-safe quoting (SPEC §11). */

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** UTF-8 BOM so Excel detects encoding, CRLF rows, every field quoted as needed. */
export function buildCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
