import { getSessionAdmin } from "@/lib/auth";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Change password — KDP Mail Approval" };

export default async function PasswordPage() {
  const session = (await getSessionAdmin())!; // layout guarantees a session

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Change password</h1>
      {session.admin.mustChangePassword ? (
        <p className="mt-2 text-sm text-amber-700">
          You&apos;re using a temporary password. Choose a new one before
          continuing — at least 12 characters.
        </p>
      ) : (
        <p className="mt-2 text-sm text-gray-600">
          Choose a new password of at least 12 characters.
        </p>
      )}
      <PasswordForm />
    </main>
  );
}
