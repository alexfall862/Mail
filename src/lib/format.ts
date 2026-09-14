/** Shared display formatting. */

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Format a YYYY-MM-DD date string without timezone drift. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

/**
 * Short, stable handle for a project ("A1B2C3"), shown in email subjects and
 * on every project page. Derived from the UUID rather than stored, so it needs
 * no column and applies retroactively to projects created before it existed.
 */
export function projectRef(projectId: string): string {
  return projectId.replaceAll("-", "").slice(0, 6).toUpperCase();
}
