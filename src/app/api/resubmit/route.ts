import { NextResponse } from "next/server";
import {
  activeAdminEmails,
  projectEmailContext,
  sendAndLog,
} from "@/lib/email/send";
import { adminResubmission } from "@/lib/email/templates";
import { assertSameOrigin, getClientIp, jsonError, rateLimited } from "@/lib/http";
import { resubmitProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { resubmitRequestSchema } from "@/lib/schemas/project";

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const limit = rateLimit("submission", ip); // same 10/hour per IP as submission
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

  // §12 template 7, sent after commit.
  const ctx = await projectEmailContext(result.value.projectId);
  if (ctx) {
    await sendAndLog(
      result.value.projectId,
      await activeAdminEmails(),
      adminResubmission(
        ctx.summary,
        result.value.versionNumber,
        result.value.vendorNote,
        ctx.adminUrl,
      ),
    );
  }

  return NextResponse.json({
    ok: true,
    versionNumber: result.value.versionNumber,
  });
}
