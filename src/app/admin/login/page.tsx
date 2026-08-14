import { redirect } from "next/navigation";
import { getSessionAdmin } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Admin login — KDP Mail Approval" };

export default async function LoginPage() {
  const session = await getSessionAdmin();
  if (session) redirect("/admin");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold text-gray-900">KDP Mail Approval</h1>
      <p className="mt-1 text-sm text-gray-600">Admin sign-in</p>
      <LoginForm siteKey={process.env.TURNSTILE_SITE_KEY ?? ""} />
    </main>
  );
}
