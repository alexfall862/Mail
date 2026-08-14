"use client";

/**
 * Zoomable lightbox for artwork review (SPEC §6). Thumbnail → full-screen
 * overlay; click the image to toggle zoom, Esc or backdrop to close.
 */
import { useEffect, useState } from "react";

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
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setZoomed(false);
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
          className="fixed inset-0 z-50 overflow-auto bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="flex min-h-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              onClick={(e) => {
                e.stopPropagation();
                setZoomed((z) => !z);
              }}
              className={
                zoomed
                  ? "max-w-none cursor-zoom-out"
                  : "max-h-[90vh] max-w-full cursor-zoom-in object-contain"
              }
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="fixed right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-gray-900"
          >
            Close ✕
          </button>
        </div>
      )}
    </>
  );
}
