/**
 * Browser → R2 direct upload (SPEC §3): request a presigned PUT from the app,
 * then send the bytes straight to R2 with progress reporting. The app server
 * never sees the file body.
 */
import type { PresignRequest, PresignResponse } from "@/lib/schemas/uploads";

export class UploadError extends Error {}

export async function requestPresign(
  request: PresignRequest,
): Promise<PresignResponse> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const data = (await res.json().catch(() => ({}))) as PresignResponse & {
    error?: string;
  };
  if (!res.ok) {
    throw new UploadError(data.error ?? "Could not prepare the upload. Please try again.");
  }
  return data;
}

/** PUT a blob to a presigned URL, reporting progress in [0, 1]. */
export function putToR2(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else if (xhr.status === 403) {
        reject(
          new UploadError(
            "The upload window expired. Please re-attach the file and try again.",
          ),
        );
      } else {
        reject(new UploadError(`Upload failed (status ${xhr.status}). Please try again.`));
      }
    };
    xhr.onerror = () =>
      reject(new UploadError("Upload failed. Check your connection and try again."));
    xhr.send(blob);
  });
}
