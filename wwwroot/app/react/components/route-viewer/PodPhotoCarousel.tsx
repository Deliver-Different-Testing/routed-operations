import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';

// POD photo carousel for the Route Viewer Detail pane. Fetches
// `List<byte[]>` from GET /api/runviewer/jobs/pod-photos which
// System.Text.Json serialises to `string[]` (base64). Wraps each entry
// with `data:image/jpeg;base64,` for the img src. Renders 0-N photos
// with prev / next navigation + click-to-enlarge lightbox.
//
// Silent-empty behaviour: shows nothing (returns null) when a job has
// no photos yet. That keeps the Detail pane visually clean until POD
// is actually recorded.

interface Props {
  bulkJobId: number | null;
}

export function PodPhotoCarousel({ bulkJobId }: Props) {
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const q = useQuery({
    queryKey: ['rv-pod-photos', bulkJobId],
    queryFn: () => routeViewerService.getPodPhotos(bulkJobId!),
    enabled: bulkJobId != null,
    staleTime: 60_000,
  });

  // Reset the visible slide whenever the job changes.
  useEffect(() => { setIdx(0); setLightbox(false); }, [bulkJobId]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const photos = q.data ?? [];
  if (bulkJobId == null || photos.length === 0) return null;

  const current = photos[idx];
  const prev = () => setIdx((i) => (i - 1 + photos.length) % photos.length);
  const next = () => setIdx((i) => (i + 1) % photos.length);

  return (
    <>
      <div className="border border-border rounded bg-white mx-2 mb-2">
        <div className="px-3 py-1.5 border-b border-border text-[10px] uppercase tracking-wide text-text-muted font-medium flex items-center gap-2">
          <span>POD Photos</span>
          <span className="text-text-primary">{idx + 1} / {photos.length}</span>
          <div className="ml-auto flex items-center gap-1">
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={prev}
                  className="px-2 py-0.5 text-xs border border-border rounded hover:bg-surface-cream"
                  title="Previous"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="px-2 py-0.5 text-xs border border-border rounded hover:bg-surface-cream"
                  title="Next"
                >
                  ▶
                </button>
              </>
            )}
          </div>
        </div>
        <div className="p-3 flex items-center justify-center bg-surface-cream/40">
          <img
            src={`data:image/jpeg;base64,${current}`}
            alt={`POD photo ${idx + 1}`}
            className="max-h-64 cursor-zoom-in rounded border border-border"
            onClick={() => setLightbox(true)}
            title="Click to enlarge"
          />
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightbox(false)}
        >
          <img
            src={`data:image/jpeg;base64,${current}`}
            alt={`POD photo ${idx + 1} full size`}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </>
  );
}
