import { useEffect, useRef } from 'react';
import type { BulkPolygon, PolygonAppCode } from '../../services/bulkPolygonService';
import { appsOf, isPerimeter, zoneText, POLYGON_CARD_HINT } from '../../lib/polygonFilters';
import { PolygonUsedByToggles } from './PolygonUsedBy';

interface PolygonCardProps {
  polygon: BulkPolygon;
  /** Swatch colour, the same one the list row and the map use. */
  colour: string;
  /** "Updated <date>" text, built by the page from its audit date format. */
  updatedText: string;
  updatedTitle?: string;
  saving: boolean;
  /** Set when Edit shape cannot start (too many vertices); used as title. */
  editDisabledReason?: string;
  onToggleApp: (app: PolygonAppCode, on: boolean) => void;
  onEditShape: () => void;
  onZoom: () => void;
  onClose: () => void;
}

/** Click-to-open polygon card over the map (review C6, Steve's mock):
 *  name, Layer, Zone, the Used by chips, Edit shape, Zoom and Updated. */
export function PolygonCard({
  polygon: p, colour, updatedText, updatedTitle, saving, editDisabledReason,
  onToggleApp, onEditShape, onZoom, onClose,
}: PolygonCardProps) {
  const perimeter = isPerimeter(p);
  const zone = zoneText(p);
  // Move focus to the card when it opens (or switches polygon) so keyboard
  // and screen reader users land on it. Leave focus alone if the operator is
  // typing in a box, such as the list search or the filter bar.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
      || active.tagName === 'SELECT' || active.isContentEditable)) return;
    rootRef.current?.focus({ preventScroll: true });
  }, [p.polygonId]);
  return (
    <div ref={rootRef} tabIndex={-1} data-testid="pb-polygon-card" role="region" aria-label={`Polygon ${p.name}`}
      className="absolute left-3 bottom-24 z-20 w-80 rounded-lg border border-border bg-surface-white shadow-lg p-3 text-xs space-y-2">
      <div className="flex items-center gap-2">
        <span data-testid="pb-polygon-card-swatch" data-perimeter={perimeter}
          className={`w-3 h-3 rounded-sm shrink-0 ${perimeter ? 'border border-dashed' : ''}`}
          style={perimeter
            ? { borderColor: colour, background: 'transparent' }
            : { background: colour }} />
        <h3 className="flex-1 truncate font-semibold text-sm" title={p.name}
          data-testid="pb-polygon-card-name">{p.name}</h3>
        <button type="button" aria-label="Close polygon card" onClick={onClose}
          className="text-text-muted hover:text-text-primary text-base leading-none">&times;</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div data-testid="pb-polygon-card-layer">
          <span className="block text-[9px] uppercase tracking-wide text-text-muted">Layer</span>
          {p.layer ? <span className="truncate">{p.layer}</span> : <i className="text-text-muted">No layer</i>}
        </div>
        <div data-testid="pb-polygon-card-zone">
          <span className="block text-[9px] uppercase tracking-wide text-text-muted">Zone</span>
          {zone ? <span className="truncate" title={zone}>{zone}</span> : <i className="text-text-muted">not in a zone</i>}
        </div>
      </div>
      <PolygonUsedByToggles
        variant="chip"
        apps={appsOf(p)}
        polygon={p}
        nameSuffix={p.name}
        disabled={saving}
        onToggle={onToggleApp}
      />
      <div className="text-[10px] text-text-muted">{POLYGON_CARD_HINT}</div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onEditShape} disabled={editDisabledReason != null}
          title={editDisabledReason}
          className="text-[10px] font-semibold px-2 py-0.5 rounded border border-brand-purple text-brand-purple hover:bg-brand-purple/10 disabled:opacity-40">
          Edit shape
        </button>
        <button type="button" onClick={onZoom}
          className="text-[10px] font-semibold px-2 py-0.5 rounded border border-border hover:bg-surface-cream">
          Zoom
        </button>
        <span className="flex-1" />
        <span className="text-[10px] text-text-muted" title={updatedTitle}
          data-testid="pb-polygon-card-updated">{updatedText}</span>
      </div>
    </div>
  );
}
