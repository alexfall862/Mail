/**
 * Browser-side artwork pipeline (SPEC §6). Everything happens in the browser:
 * PDFs are rasterized with pdfjs-dist, images are downscaled on a canvas, and
 * only the resulting review-fidelity JPEGs ever leave the machine. Originals
 * are never uploaded.
 */

export const TARGET_LONG_EDGE_SIDE = 2500; // front/back/auto-split pages
export const TARGET_LONG_EDGE_COMBINED = 3500; // stacked two-sides-in-one image
export const MIN_DIMENSION_PX = 600;
export const JPEG_QUALITY = 0.85;
export const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

export const ARTWORK_INPUT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export type ProcessedImage = {
  blob: Blob;
  width: number;
  height: number;
};

export class ArtworkError extends Error {}

/** §6 step 4. */
const TOO_SMALL_MESSAGE =
  `This image is too small to review: its shortest side must be at least ${MIN_DIMENSION_PX} pixels. ` +
  "Try exporting the artwork at a higher resolution (150 DPI or more at the piece's printed size), " +
  "or upload the print-ready PDF instead — PDFs are rendered at full review quality automatically.";

/**
 * Process a separate-mode front or back file (image or PDF page 1).
 * Returns the JPEG plus a user-visible note when PDF pages were ignored.
 */
export async function processSideFile(
  file: File,
): Promise<{ image: ProcessedImage; note: string | null }> {
  if (file.type === "application/pdf") {
    const pdf = await openPdf(file);
    try {
      const image = await renderPdfPageToJpeg(pdf, 1, TARGET_LONG_EDGE_SIDE);
      const note =
        pdf.numPages > 1
          ? `Only page 1 of "${file.name}" was used (${pdf.numPages} pages in the file).`
          : null;
      return { image, note };
    } finally {
      await pdf.destroy();
    }
  }
  return { image: await downscaleImageToJpeg(file, TARGET_LONG_EDGE_SIDE), note: null };
}

export type CombinedResult =
  | { mode: "split"; front: ProcessedImage; back: ProcessedImage; note: string | null }
  | { mode: "combined"; image: ProcessedImage; note: null };

/**
 * Process a combined-mode file (§6): a multi-page PDF auto-splits — page 1
 * becomes the front, page 2 the back (pages 3+ ignored with a note); a single
 * image or 1-page PDF stays one combined file.
 */
export async function processCombinedFile(file: File): Promise<CombinedResult> {
  if (file.type === "application/pdf") {
    const pdf = await openPdf(file);
    try {
      if (pdf.numPages >= 2) {
        const front = await renderPdfPageToJpeg(pdf, 1, TARGET_LONG_EDGE_SIDE);
        const back = await renderPdfPageToJpeg(pdf, 2, TARGET_LONG_EDGE_SIDE);
        const note =
          pdf.numPages > 2
            ? `Only pages 1–2 of "${file.name}" were used (${pdf.numPages} pages in the file).`
            : null;
        return { mode: "split", front, back, note };
      }
      const image = await renderPdfPageToJpeg(pdf, 1, TARGET_LONG_EDGE_COMBINED);
      return { mode: "combined", image, note: null };
    } finally {
      await pdf.destroy();
    }
  }
  return {
    mode: "combined",
    image: await downscaleImageToJpeg(file, TARGET_LONG_EDGE_COMBINED),
    note: null,
  };
}

/** §6 steps 2–5 for raster images: downscale (never upscale) and export JPEG. */
async function downscaleImageToJpeg(
  file: File,
  targetLongEdge: number,
): Promise<ProcessedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ArtworkError(
      `"${file.name}" could not be read as an image. Please upload a JPEG, PNG, WebP, or PDF.`,
    );
  }
  try {
    const scale = Math.min(1, targetLongEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    // §6 step 3: white background so transparent PNGs don't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvasToJpeg(canvas);
  } finally {
    bitmap.close();
  }
}

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};
type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

async function openPdf(file: File): Promise<PdfDocument> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  try {
    const data = await file.arrayBuffer();
    return (await pdfjs.getDocument({ data }).promise) as unknown as PdfDocument;
  } catch {
    throw new ArtworkError(
      `"${file.name}" could not be opened as a PDF. The file may be corrupted or password-protected.`,
    );
  }
}

/** §6 step 1: rasterize a PDF page at a scale yielding the target long edge. */
async function renderPdfPageToJpeg(
  pdf: PdfDocument,
  pageNumber: number,
  targetLongEdge: number,
): Promise<ProcessedImage> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = targetLongEdge / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  // Fill behind any transparency, without disturbing rendered content.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  return canvasToJpeg(canvas);
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<ProcessedImage> {
  const { width, height } = canvas;
  if (Math.min(width, height) < MIN_DIMENSION_PX) {
    throw new ArtworkError(TOO_SMALL_MESSAGE);
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new ArtworkError("Could not process the image. Please try a different file.");
  if (blob.size > MAX_ARTWORK_BYTES) {
    throw new ArtworkError(
      "Processed artwork is unexpectedly large. Please try a smaller file.",
    );
  }
  return { blob, width, height };
}
