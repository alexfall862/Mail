"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AdminRow = {
  id: string;
  email: string;
  name: string;
  isSuperuser: boolean;
  active: boolean;
  createdAt: string;
};

export function UserManager({
  admins,
  selfId,
}: {
  admins: AdminRow[];
  selfId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Temp passwords shown once, keyed by email.
  const [revealed, setRevealed] = useState<Array<{ email: string; password: string }>>([]);

  async function post(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong.");
        return null;
      }
      return data;
    } catch {
      setError("Network error. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      {revealed.length > 0 && (
        <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            Temporary passwords — copy now, they won&apos;t be shown again:
          </p>
          <ul className="mt-2 space-y-1 font-mono">
            {revealed.map((r) => (
              <li key={r.email}>
                {r.email}: {r.password}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Create admin</h2>
        <form
          className="mt-4 flex flex-wrap items-end gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = await post("/api/admin/users", { email, name, isSuperuser });
            if (data?.tempPassword) {
              setRevealed((r) => [
                ...r,
                { email: email.trim().toLowerCase(), password: String(data.tempPassword) },
              ]);
              setEmail("");
              setName("");
              setIsSuperuser(false);
              router.refresh();
            }
          }}
        >
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              required
              className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              required
              type="email"
              className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isSuperuser}
              onChange={(e) => setIsSuperuser(e.target.checked)}
            />
            Superuser
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            Create
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </section>

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {admins.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {a.name}
                  {a.id === selfId && (
                    <span className="ml-2 text-xs text-gray-500">(you)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{a.email}</td>
                <td className="px-4 py-3">{a.isSuperuser ? "Superuser" : "Admin"}</td>
                <td className="px-4 py-3">
                  {a.active ? (
                    <span className="text-green-700">Active</span>
                  ) : (
                    <span className="text-gray-400">Deactivated</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{a.createdAt}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {a.active && a.id !== selfId && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`Deactivate ${a.email}? Their sessions are ended immediately.`)) return;
                          const data = await post(`/api/admin/users/${a.id}`, { action: "deactivate" });
                          if (data) router.refresh();
                        }}
                        className="text-xs text-red-700 underline"
                      >
                        Deactivate
                      </button>
                    )}
                    {!a.active && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          const data = await post(`/api/admin/users/${a.id}`, { action: "reactivate" });
                          if (data) router.refresh();
                        }}
                        className="text-xs text-blue-700 underline"
                      >
                        Reactivate
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm(`Reset the password for ${a.email}? Their sessions are ended and a new temporary password is shown to you once.`)) return;
                        const data = await post(`/api/admin/users/${a.id}`, { action: "reset-password" });
                        if (data?.tempPassword) {
                          setRevealed((r) => [...r, { email: a.email, password: String(data.tempPassword) }]);
                          router.refresh();
                        }
                      }}
                      className="text-xs text-gray-700 underline"
                    >
                      Reset password
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
