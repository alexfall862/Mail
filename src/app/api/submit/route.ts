import { NextResponse } from "next/server";
import { after } from "next/server";
import { runAiReview } from "@/lib/ai-review";
import { verifyDraftToken } from "@/lib/draft-token";
import {
  activeAdminEmails,
  projectEmailContext,
  sendAndLog,
} from "@/lib/email/send";
import {
  adminNewSubmission,
  vendorConfirmation,
} from "@/lib/email/templates";
import { vendorLinkUrl } from "@/lib/tokens";
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

  // §12 templates 1–2, sent after commit; failures are logged, never thrown.
  const ctx = await projectEmailContext(projectId);
  if (ctx) {
    const magicLink = vendorLinkUrl(result.value.rawVendorToken);
    await sendAndLog(
      projectId,
      ctx.primaries,
      vendorConfirmation(ctx.summary, magicLink),
      { cc: await activeAdminEmails() }, // admins see what vendors receive
    );
    await sendAndLog(
      projectId,
      await activeAdminEmails(),
      adminNewSubmission(ctx.summary, ctx.adminUrl),
    );
  }

  // AI pre-check kicks off after the response is sent, so the vendor isn't
  // kept waiting; the outcome lands in the event timeline for the admin team.
  after(() => runAiReview(projectId, { trigger: "submission" }));

  return NextResponse.json({ ok: true });
}
