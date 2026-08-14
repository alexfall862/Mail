/**
 * Session-guarded admin shell. Redirects to login without a valid DB-backed
 * session and forces the password-change screen while must_change_password
 * is set (§7).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAdmin } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionAdmin();
  if (!session) redirect("/admin/login");
  if (session.admin.mustChangePassword) redirect("/admin/settings/password");

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/admin" className="font-bold text-gray-900">
            KDP Mail Approval
          </Link>
          <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
            Dashboard
          </Link>
          <Link
            href="/admin/export"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Export
          </Link>
          {session.admin.isSuperuser && (
            <Link
              href="/admin/users"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Users
            </Link>
          )}
          <div className="ml-auto flex items-center gap-4">
            <Link
              href="/admin/settings/password"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              {session.admin.name}
            </Link>
            <form action="/api/admin/logout" method="post">
              <button
                type="submit"
                className="text-sm text-gray-600 underline hover:text-gray-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
