import { POLYGON_APPS, type BulkPolygon, type PolygonAppCode } from '../../services/bulkPolygonService';
import { APP_META, appsOf, remainingBinding, PERIMETER_CONFIRM_TEXT } from '../../lib/polygonFilters';

/** Small app badges on a list row (Sch, AD, Rt, Zr, CB), or "not used" in
 *  italics when the polygon has no app (spec 4.4.2). */
export function PolygonAppBadges({ apps }: { apps?: PolygonAppCode[] | null }) {
  const own = appsOf({ apps });
  if (own.length === 0) {
    return <span className="text-[9px] italic text-text-muted whitespace-nowrap" data-testid="pb-app-badges">not used</span>;
  }
  return (
    <span className="inline-flex flex-wrap justify-end gap-0.5" data-testid="pb-app-badges">
      {POLYGON_APPS.filter((a) => own.includes(a)).map((a) => (
        <span key={a} title={APP_META[a].label}
          className="inline-block px-1 rounded text-[9px] font-bold text-white leading-[14px]"
          style={{ background: APP_META[a].colour }}>
          {APP_META[a].badge}
        </span>
      ))}
    </span>
  );
}

/** Ask before PERIMETER is turned on or off (spec 4.4.3). Resolves true on
 *  Continue. `confirm` is the page's useConfirm() function. */
export function confirmPerimeterChange(
  confirm: (opts: { title?: string; message: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>,
): Promise<boolean> {
  return confirm({
    title: 'City boundary',
    message: PERIMETER_CONFIRM_TEXT,
    confirmLabel: 'Continue',
    cancelLabel: 'Cancel',
  });
}

interface UsedByTogglesProps {
  apps: PolygonAppCode[];
  /** Called with the app and its new state. The caller confirms PERIMETER
   *  and saves. */
  onToggle: (app: PolygonAppCode, on: boolean) => void;
  disabled?: boolean;
  /** The saved polygon, for the Q4 "binding still applies" note. Omit on
   *  the create modal (a new drawing has no bindings). */
  polygon?: Partial<Pick<BulkPolygon, 'zoneMemberships' | 'postcodeGroupId' | 'zoneNameId' | 'attachedRouteCount' | 'attachedRoutes' | 'name'>>;
  /** Accessible-name suffix so each row's buttons are distinct. */
  nameSuffix?: string;
}

/** "Used by" row of toggle buttons: Schedules, Auto Dispatch, Routes, Zone
 *  rating, City boundary (spec 4.4.3). */
export function PolygonUsedByToggles({ apps, onToggle, disabled = false, polygon, nameSuffix }: UsedByTogglesProps) {
  // Q4: unticking an app the polygon is still bound to is allowed, but
  // availability keeps reading the binding. Say so in one line.
  const notes = polygon
    ? POLYGON_APPS
        .filter((a) => !apps.includes(a))
        .map((a) => ({ a, binding: remainingBinding(polygon, a) }))
        .filter((x): x is { a: PolygonAppCode; binding: string } => x.binding != null)
    : [];
  return (
    <div data-testid="pb-used-by">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[9px] uppercase tracking-wide text-text-muted mr-0.5">Used by</span>
        {POLYGON_APPS.map((a) => {
          const on = apps.includes(a);
          return (
            <button key={a} type="button" disabled={disabled}
              aria-pressed={on}
              aria-label={nameSuffix ? `${APP_META[a].label} for ${nameSuffix}` : APP_META[a].label}
              onClick={() => onToggle(a, !on)}
              title={APP_META[a].hint}
              className={`text-[9px] px-1.5 py-0.5 rounded-full border disabled:opacity-40 ${on
                ? 'text-white font-semibold'
                : 'border-border text-text-muted hover:text-text-primary'} ${a === 'PERIMETER' && on ? 'border-dashed' : ''}`}
              style={on ? { background: APP_META[a].colour, borderColor: APP_META[a].colour } : undefined}>
              {APP_META[a].label}
            </button>
          );
        })}
      </div>
      {notes.map(({ a, binding }) => (
        <div key={a} className="mt-0.5 text-[9px] text-warning italic" data-testid="pb-used-by-note">
          {APP_META[a].label} is off but this polygon still has {binding}; availability still uses the binding.
        </div>
      ))}
    </div>
  );
}
