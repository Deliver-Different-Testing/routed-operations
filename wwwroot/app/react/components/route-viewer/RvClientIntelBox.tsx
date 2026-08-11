import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Client Intel box (master Section 7.15.1). Right-column slim panel
// showing per-mobile delivery intel for the currently-selected job:
// dangerous-dog flag, access notes, and any photos on file. Read
// from RVW_stpClientIntel via /api/runviewer/jobs/client-intel and
// the sibling images endpoint.
//
// Empty when no mobile is available or no intel record exists on
// file - the box stays present so the operator sees a clear "no
// intel" state instead of the box disappearing.

interface Props {
  /** Mobile number to look up intel for. Comes from the currently
   *  selected job's DeliverToPhone / TrackingPhone. Empty string
   *  means "no job selected" - box renders an idle state. */
  mobile: string | null | undefined;
}

export function RvClientIntelBox({ mobile }: Props) {
  const enabled = !!mobile && mobile.trim().length > 0;
  const intelQ = useQuery({
    queryKey: ['rv-client-intel', mobile ?? ''],
    queryFn: () => routeViewerService.getClientIntel(mobile ?? ''),
    enabled,
    staleTime: 60_000,
  });
  const imagesQ = useQuery({
    queryKey: ['rv-client-intel-images', mobile ?? ''],
    queryFn: () => routeViewerService.getClientIntelImages(mobile ?? ''),
    enabled: enabled && (intelQ.data?.hasPhoto ?? false),
    staleTime: 60_000,
  });

  const intel = intelQ.data;

  return (
    <RvBox title="Client Intel">
      {!enabled && (
        <div className="p-3 text-xs text-text-muted">
          Select a job with a mobile number to view its client intel.
        </div>
      )}
      {enabled && intelQ.isLoading && (
        <div className="p-3 text-xs text-text-muted">Loading intel...</div>
      )}
      {enabled && !intelQ.isLoading && !intel && (
        <div className="p-3 text-xs text-text-muted">
          No intel on file for <span className="font-mono">{mobile}</span>.
        </div>
      )}
      {enabled && intel && (
        <div className="p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Mobile</span>
            <span className="font-mono">{intel.mobile ?? mobile}</span>
          </div>
          {intel.dog && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2 1 21h22L12 2zm0 6 6.6 11H5.4L12 8zm-1 3v4h2v-4h-2zm0 5v2h2v-2h-2z" />
              </svg>
              Dangerous Dog
            </div>
          )}
          {intel.notes && (
            <div className="space-y-0.5">
              <div className="text-text-muted">Notes</div>
              <div className="whitespace-pre-wrap text-text-primary">{intel.notes}</div>
            </div>
          )}
          {intel.hasPhoto && imagesQ.data && imagesQ.data.length > 0 && (
            <div className="space-y-1">
              <div className="text-text-muted">Photos ({imagesQ.data.length})</div>
              <div className="flex flex-wrap gap-1">
                {imagesQ.data.map((img, i) => (
                  <img
                    key={img.key ?? i}
                    src={img.photo ? `data:image/jpeg;base64,${img.photo}` : ''}
                    title={img.description ?? undefined}
                    alt={img.description ?? `intel-${i}`}
                    className="w-16 h-16 object-cover rounded border border-border"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </RvBox>
  );
}
