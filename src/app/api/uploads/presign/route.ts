import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, submissionVersions } from "@/db/schema";
import { issueDraftToken, verifyDraftToken } from "@/lib/draft-token";
import { assertSameOrigin, getClientIp, jsonError, rateLimited } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { presignPut } from "@/lib/r2";
import { presignRequestSchema, type PresignResponse } from "@/lib/schemas/uploads";
import { hashVendorToken } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";
import { buildR2Key, validatePresignRequest } from "@/lib/uploads";

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const limit = rateLimit("presign", ip); // §6: 20/hour per IP
  if (!limit.allowed) return rateLimited(limit);

  const parsed = presignRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return jsonError(400, "Invalid upload request.");
  const { kind, contentType, sizeBytes, auth } = parsed.data;

  const validation = validatePresignRequest(kind, contentType, sizeBytes);
  if (!validation.ok) return jsonError(400, validation.message);

  let projectId: string;
  let versionNumber: number;
  let issuedDraftToken: string | undefined;

  if (auth.mode === "new") {
    const fromDraft = auth.draftToken ? verifyDraftToken(auth.draftToken) : null;
    if (fromDraft) {
      projectId = fromDraft;
    } else {
      if (!auth.turnstileToken) {
        return jsonError(400, "Verification required. Please reload and try again.");
      }
      if (!(await verifyTurnstile(auth.turnstileToken, ip))) {
        return jsonError(400, "Verification failed. Please reload and try again.");
      }
      // §6: project id is generated at presign time; the row is only created
      // on successful final submit.
      projectId = randomUUID();
      issuedDraftToken = issueDraftToken(projectId);
    }
    versionNumber = 1;
  } else {
    // Resubmission: the magic link is the credential. Uploads are only
    // meaningful while the vendor may act (status = changes_requested), and
    // they always target the NEXT version's prefix — existing objects can
    // never be overwritten.
    const tokenHash = hashVendorToken(auth.vendorToken);
    const [project] = await db
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(eq(projects.vendorTokenHash, tokenHash));
    if (!project) return jsonError(404, "This link is no longer valid.");
    if (project.status !== "changes_requested") {
      return jsonError(
        409,
        "This project is not currently accepting a resubmission.",
      );
    }
    const [latest] = await db
      .select({ versionNumber: submissionVersions.versionNumber })
      .from(submissionVersions)
      .where(eq(submissionVersions.projectId, project.id))
      .orderBy(desc(submissionVersions.versionNumber))
      .limit(1);
    projectId = project.id;
    versionNumber = (latest?.versionNumber ?? 0) + 1;
  }

  const key = buildR2Key(projectId, versionNumber, kind, contentType);
  const url = await presignPut(key, contentType, sizeBytes);

  const response: PresignResponse = { url, key };
  if (issuedDraftToken) response.draftToken = issuedDraftToken;
  return NextResponse.json(response);
}
