"use client";

/**
 * Zoomable lightbox for artwork review (SPEC §6). Thumbnail opens a
 * full-screen overlay fitted to the window; the +/- controls (or clicking the
 * image) step through deeper magnification based on the image's natural
 * pixel size. Esc, the close button, or the backdrop closes it.
 */
import { useEffect, useRef, useState } from "react";

/** Multiples of the image's natural size; null means "fit to window". */
const ZOOM_LEVELS = [1, 1.5, 2, 3] as const;

export function ArtworkImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "+" || e.key === "=") zoomIn();
      if (e.key === "-") zoomOut();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  });

  function zoomIn() {
    setZoomIndex((z) =>
      z === null ? 0 : Math.min(z + 1, ZOOM_LEVELS.length - 1),
    );
  }

  function zoomOut() {
    setZoomIndex((z) => (z === null || z === 0 ? null : z - 1));
  }

  const zoomLabel =
    zoomIndex === null ? "Fit" : `${Math.round(ZOOM_LEVELS[zoomIndex]! * 100)}%`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setZoomIndex(null);
          setOpen(true);
        }}
        className={className ?? "block w-full"}
        title="Click to enlarge"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="w-full rounded border border-gray-200 shadow-sm"
        />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 overflow-auto bg-black/80"
          onClick={() => setOpen(false)}
        >
          <div className="flex min-h-full min-w-fit items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={src}
              alt={alt}
              onLoad={(e) => setNaturalWidth(e.currentTarget.naturalWidth)}
              onClick={(e) => {
                e.stopPropagation();
                zoomIn();
              }}
              className={
                zoomIndex === null
                  ? "max-h-[90vh] max-w-[95vw] cursor-zoom-in object-contain"
                  : zoomIndex < ZOOM_LEVELS.length - 1
                    ? "max-w-none cursor-zoom-in"
                    : "max-w-none"
              }
              style={
                zoomIndex !== null && naturalWidth
                  ? { width: naturalWidth * ZOOM_LEVELS[zoomIndex]! }
                  : undefined
              }
            />
          </div>
          <div
            className="fixed right-4 top-4 flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoomIndex === null}
              aria-label="Zoom out"
              className="h-9 w-9 rounded-full bg-white/90 text-lg font-bold text-gray-900 disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-14 rounded-full bg-white/90 px-3 py-1.5 text-center text-sm font-semibold text-gray-900">
              {zoomLabel}
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              aria-label="Zoom in"
              className="h-9 w-9 rounded-full bg-white/90 text-lg font-bold text-gray-900 disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-gray-900"
            >
              Close ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
