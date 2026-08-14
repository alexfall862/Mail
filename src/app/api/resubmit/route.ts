import { NextResponse } from "next/server";
import { assertSameOrigin, getClientIp, jsonError, rateLimited } from "@/lib/http";
import { resubmitProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { resubmitRequestSchema } from "@/lib/schemas/project";

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const limit = rateLimit("submission", ip); // same 5/hour per IP as submission
  if (!limit.allowed) return rateLimited(limit);

  const parsed = resubmitRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(
      400,
      parsed.error.issues[0]?.message ?? "Invalid resubmission.",
    );
  }

  const result = await resubmitProject(parsed.data);
  if (!result.ok) return jsonError(result.status, result.message);

  // Phase 7 wires the admin_resubmission email here (post-commit).

  return NextResponse.json({
    ok: true,
    versionNumber: result.value.versionNumber,
  });
}
