/**
 * Cloudflare R2 access (SPEC §3): the app only mints presigned URLs and reads
 * metadata — file bytes never pass through this server. Bucket is private;
 * every browser read/write uses a short-lived presigned URL (10 minutes).
 */
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const PRESIGN_EXPIRY_SECONDS = 10 * 60;

let client: S3Client | null = null;

function r2(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return client;
}

function bucket(): string {
  return process.env.R2_BUCKET ?? "";
}

/** Presigned PUT with content-type and content-length locked into the signature. */
export async function presignPut(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    {
      expiresIn: PRESIGN_EXPIRY_SECONDS,
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
}

/** Presigned GET for review display (10-minute expiry). */
export async function presignGet(key: string): Promise<string> {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  );
}

export type HeadResult = {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
};

/** HEAD an object to confirm existence/size/content-type (never the bytes). */
export async function headObject(key: string): Promise<HeadResult> {
  try {
    const res = await r2().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: key }),
    );
    return {
      exists: true,
      sizeBytes: res.ContentLength,
      contentType: res.ContentType,
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Delete every object under a project's prefix (SPEC §10). Paginates; returns
 * the number deleted and whether the prefix verified empty afterwards.
 */
export async function deleteProjectPrefix(
  projectId: string,
): Promise<{ deleted: number; verifiedEmpty: boolean }> {
  const prefix = `projects/${projectId}/`;
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const page = await r2().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k));
    if (keys.length > 0) {
      await r2().send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      deleted += keys.length;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const check = await r2().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, MaxKeys: 1 }),
  );
  return { deleted, verifiedEmpty: (check.KeyCount ?? 0) === 0 };
}
