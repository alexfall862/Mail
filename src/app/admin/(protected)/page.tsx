export const metadata = { title: "Dashboard — KDP Mail Approval" };

// Placeholder — the real dashboard (mail-date sort, ≤10-day flag, paid
// badges, status filter) lands in the admin-surface phase.
export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-4 text-gray-600">
        No projects yet. When vendors submit mail pieces, they&apos;ll appear
        here sorted by mail date.
      </p>
    </div>
  );
}
