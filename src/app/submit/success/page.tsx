import Link from "next/link";

export const metadata = { title: "Submission received - KDP Mail Approval" };

export default function SubmitSuccessPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-green-100 p-4 text-3xl">✓</div>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">
        Submission received
      </h1>
      <p className="mt-3 text-gray-600">
        Thanks. Your mail piece is in the review queue. We&apos;ve emailed
        your primary contact a <strong>private status link</strong>. Bookmark
        it: it&apos;s how you check progress and send revisions if changes are
        requested. You&apos;ll also get an email at every step.
      </p>
      <Link href="/" className="mt-8 text-blue-700 underline">
        Back to the start page
      </Link>
    </main>
  );
}
