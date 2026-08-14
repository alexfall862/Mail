import { NextResponse } from "next/server";
import { verifyDraftToken } from "@/lib/draft-token";
import { assertSameOrigin, getClientIp, jsonError, rateLimited } from "@/lib/http";
import { createProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { submitRequestSchema } from "@/lib/schemas/project";

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const limit = rateLimit("submission", ip); // §13: 5/hour per IP
  if (!limit.allowed) return rateLimited(limit);

  const parsed = submitRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(
      400,
      parsed.error.issues[0]?.message ?? "Invalid submission.",
    );
  }

  // The draft token was issued after a Turnstile pass at the first presign
  // (§6) — it both authenticates this flow and pins the project id.
  const projectId = verifyDraftToken(parsed.data.draftToken);
  if (!projectId) {
    return jsonError(
      400,
      "Your form session has expired. Please reload the page and try again.",
    );
  }

  const result = await createProject(parsed.data, projectId);
  if (!result.ok) return jsonError(result.status, result.message);

  // Phase 7 wires emails here (post-commit): vendor_confirmation with the
  // magic link + admin_new_submission.

  return NextResponse.json({ ok: true });
}
