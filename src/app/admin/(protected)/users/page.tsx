import { redirect } from "next/navigation";
import { getSessionAdmin } from "@/lib/auth";
import { listAdmins } from "@/lib/admin-users";
import { formatDateTime } from "@/lib/format";
import { UserManager } from "./user-manager";

export const metadata = { title: "Admin users - KDP Mail Approval" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = (await getSessionAdmin())!;
  if (!session.admin.isSuperuser) redirect("/admin");

  const admins = await listAdmins();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Admin users</h1>
      <p className="mt-1 text-sm text-gray-600">
        New and reset accounts get a temporary password shown once. Hand it
        over out-of-band. A password change is forced at first sign-in.
      </p>
      <UserManager
        selfId={session.admin.id}
        admins={admins.map((a) => ({
          id: a.id,
          email: a.email,
          name: a.name,
          isSuperuser: a.isSuperuser,
          active: a.active,
          createdAt: formatDateTime(a.createdAt),
        }))}
      />
    </div>
  );
}
