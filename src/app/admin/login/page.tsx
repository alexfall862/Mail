import { redirect } from "next/navigation";
import { getSessionAdmin } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Admin login - KDP Mail Approval" };

export default async function LoginPage() {
  const session = await getSessionAdmin();
  if (session) redirect("/admin");

  const supportEmail = process.env.ADMIN_SUPPORT_EMAIL?.trim();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold text-gray-900">KDP Mail Approval</h1>
      <p className="mt-1 text-sm text-gray-600">Admin sign-in</p>
      <LoginForm siteKey={process.env.TURNSTILE_SITE_KEY ?? ""} />
      <p className="mt-6 border-t border-gray-200 pt-4 text-sm text-gray-600">
        <span className="font-medium text-gray-700">Forgot your password?</span>{" "}
        Passwords can&apos;t be looked up, only replaced. Ask a superuser to
        reset yours from the admin user list
        {supportEmail ? (
          <>
            {" "}
            &mdash;{" "}
            <a
              href={`mailto:${supportEmail}?subject=${encodeURIComponent("KDP Mail Approval: password reset")}`}
              className="text-blue-700 underline"
            >
              {supportEmail}
            </a>
          </>
        ) : null}
        . You&apos;ll get a temporary password and be asked to choose a new one
        when you sign in.
      </p>
    </main>
  );
}
