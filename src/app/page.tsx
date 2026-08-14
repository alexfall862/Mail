import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        KDP Mail Approval
      </h1>
      <p className="mt-4 text-lg text-gray-600">
        Submit political mail pieces to the Kansas Democratic Party for review.
        After you submit, you&apos;ll receive an email with a private link to
        track your piece through content, legal, and final review — and to send
        revisions if changes are requested.
      </p>
      <Link
        href="/submit"
        className="mt-8 rounded-md bg-blue-700 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-600"
      >
        Submit a mail piece
      </Link>
    </main>
  );
}
