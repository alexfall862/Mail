/**
 * Manual AI pre-check run (second pass during content review, including a
 * return trip to content review after a resubmission). Advisory only.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { runAiReview } from "@/lib/ai-review";
import { guardAdminRequest } from "@/lib/admin-api";
import { jsonError } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await guardAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const [project] = await db
    .select({ status: projects.status })
    .from(projects)
    .where(eq(projects.id, id));
  if (!project) return jsonError(404, "Project not found.");
  if (project.status !== "content_review") {
    return jsonError(
      409,
      "The AI pre-check runs during content review; this project is elsewhere.",
    );
  }

  const outcome = await runAiReview(id, {
    trigger: "manual",
    adminId: guard.session.admin.id,
  });
  if (!outcome.ok) return jsonError(502, `AI pre-check failed: ${outcome.message}`);
  return NextResponse.json({ ok: true, flagCount: outcome.flagCount });
}
