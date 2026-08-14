/**
 * Auth-only admin layout WITHOUT the forced-password-change redirect, so the
 * password page itself stays reachable while must_change_password is set.
 */
import { redirect } from "next/navigation";
import { getSessionAdmin } from "@/lib/auth";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionAdmin();
  if (!session) redirect("/admin/login");
  return <>{children}</>;
}
