import { ProjectForm } from "@/components/project-form";

export const metadata = { title: "Submit a mail piece — KDP Mail Approval" };

export default function SubmitPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold text-gray-900">Submit a mail piece</h1>
      <p className="mt-2 text-gray-600">
        Fill this out once per mail piece. After you submit, you&apos;ll get an
        email with a private link to track review status and send revisions —
        no account needed.
      </p>
      <div className="mt-8">
        <ProjectForm mode="new" siteKey={process.env.TURNSTILE_SITE_KEY ?? ""} />
      </div>
    </main>
  );
}
