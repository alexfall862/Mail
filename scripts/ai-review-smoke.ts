/**
 * Smoke test for the AI pre-check integration: uploads a tiny test image to
 * R2, creates a throwaway local project pointing at it, runs the real
 * OpenAI-backed pre-check, prints the outcome, and cleans everything up.
 *
 * Usage: npx tsx scripts/ai-review-smoke.ts
 * Requires DATABASE_URL, R2_*, and OPENAI_API_KEY in .env.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { files, projects, submissionVersions } from "../src/db/schema";
import { runAiReview } from "../src/lib/ai-review";
import { generateVendorToken } from "../src/lib/tokens";

// Minimal valid 1x1 JPEG. The model will (correctly) find nothing readable;
// the point is exercising presign → OpenAI fetch → strict schema round trip.
const TEST_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfebfffd9",
  "hex",
);

async function main() {
  const projectId = randomUUID();
  const key = `projects/${projectId}/v1/artwork_front.jpg`;
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: TEST_JPEG,
      ContentType: "image/jpeg",
    }),
  );
  console.log(`Uploaded test object ${key}`);

  try {
    await db.insert(projects).values({
      id: projectId,
      candidateSupported: "AI Smoke Test",
      description: "smoke test project, safe to delete",
      office: "governor",
      pieceCount: 1,
      totalCostCents: 0,
      postOfficeLocation: "Topeka",
      permitNumber: "SMOKE",
      mailDate: "2030-01-01",
      status: "content_review",
      vendorTokenHash: generateVendorToken().hash,
    });
    const [version] = await db
      .insert(submissionVersions)
      .values({ projectId, versionNumber: 1 })
      .returning({ id: submissionVersions.id });
    await db
      .update(projects)
      .set({ currentVersionId: version!.id })
      .where(eq(projects.id, projectId));
    await db.insert(files).values({
      versionId: version!.id,
      projectId,
      kind: "artwork_front",
      r2Key: key,
      originalFilename: "smoke.jpg",
      contentType: "image/jpeg",
      sizeBytes: TEST_JPEG.length,
    });

    console.log("Running AI pre-check (calls OpenAI)…");
    const outcome = await runAiReview(projectId, { trigger: "manual" });
    console.log(JSON.stringify(outcome, null, 2));
    if (!outcome.ok) process.exitCode = 1;
  } finally {
    await db.delete(projects).where(eq(projects.id, projectId));
    await s3
      .send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
      .catch((err) => console.error("R2 cleanup failed:", err));
    console.log("Cleaned up test project and object.");
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
