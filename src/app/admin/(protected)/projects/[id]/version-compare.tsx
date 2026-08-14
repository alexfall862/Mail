"use client";

/**
 * Artwork viewer with current-vs-previous version compare (SPEC §6). Each
 * version's artwork set renders as-is, so comparing across modes (separate
 * vs. combined) just shows each set side by side.
 */
import { useState } from "react";
import { ArtworkImage } from "@/components/lightbox";

export type ArtworkSet = {
  versionNumber: number;
  images: Array<{ id: string; label: string; url: string; filename: string }>;
};

function SetGrid({ set }: { set: ArtworkSet }) {
  if (set.images.length === 0) {
    return <p className="text-sm text-gray-500">No artwork on this version.</p>;
  }
  return (
    <div className={set.images.length === 2 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
      {set.images.map((img) => (
        <figure key={img.id}>
          <ArtworkImage src={img.url} alt={img.label} />
          <figcaption className="mt-1 text-sm text-gray-600">
            {img.label} — {img.filename}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function VersionCompare({
  current,
  previous,
}: {
  current: ArtworkSet;
  previous: ArtworkSet | null;
}) {
  const [comparing, setComparing] = useState(false);

  return (
    <div>
      {previous && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setComparing((c) => !c)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {comparing
              ? "Hide comparison"
              : `Compare with version ${previous.versionNumber}`}
          </button>
        </div>
      )}
      {comparing && previous ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Version {current.versionNumber} (current)
            </h3>
            <SetGrid set={current} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Version {previous.versionNumber}
            </h3>
            <SetGrid set={previous} />
          </div>
        </div>
      ) : (
        <SetGrid set={current} />
      )}
    </div>
  );
}
