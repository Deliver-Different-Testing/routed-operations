// src/modules/schedules/components/ChainBuilder.tsx
import { useRef, useCallback, useState, useImperativeHandle, forwardRef, useEffect } from 'react';
import { Plus, Package, Building2, Truck, MapPin } from 'lucide-react';
import type { Schedule, LegType, DepotReference, SpeedReference, ZoneReference, LegConfig } from '../types';
import { LegNode } from './LegNode';
import { LegConfigPanel } from './LegConfigPanel';

interface ChainBuilderProps {
  schedule: Schedule;
  selectedLegId: number | null;
  onSelectLeg: (legId: number, anchorEl?: HTMLDivElement | null) => void;
  onUpdateLeg?: (legId: number, config: LegConfig) => void;
  onAddLeg?: (afterLegId: number, type: LegType) => void;
  onRemoveLeg?: (legId: number) => void;
  readOnly?: boolean;
  lockedStructure?: boolean;
  overrideMode?: boolean;
  depots: DepotReference[];
  speeds: SpeedReference[];
  zones: ZoneReference[];
}

export interface ChainBuilderHandle {
  selectLeg: (legId: number) => void;
  selectOrigin: () => void;
}

export const ChainBuilder = forwardRef<ChainBuilderHandle, ChainBuilderProps>(function ChainBuilder({
  schedule,
  selectedLegId,
  onSelectLeg,
  onUpdateLeg,
  onAddLeg,
  onRemoveLeg,
  readOnly = false,
  lockedStructure = false,
  overrideMode = false,
  depots,
  speeds,
  zones,
}, ref) {
  const legNodeRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    selectLeg(legId: number) {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const el = legNodeRefs.current.get(legId) ?? null;
      setTimeout(() => onSelectLeg(legId, el), 300);
    },
    selectOrigin() {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  }), [onSelectLeg]);

  // MUST-FIX 4: Leg type dropdown state
  const [addMenuFor, setAddMenuFor] = useState<number | null>(null); // afterLegId that's showing dropdown
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (addMenuFor === null) return;
    const handleClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuFor(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [addMenuFor]);

  const legTypeOptions: { type: LegType; label: string; icon: typeof Package }[] = [
    { type: 'collection', label: 'Collection', icon: Package },
    { type: 'depot', label: 'Depot', icon: Building2 },
    { type: 'linehaul', label: 'Linehaul', icon: Truck },
    { type: 'delivery', label: 'Delivery', icon: MapPin },
  ];

  const setLegNodeRef = useCallback((legId: number) => (el: HTMLDivElement | null) => {
    if (el) {
      legNodeRefs.current.set(legId, el);
    } else {
      legNodeRefs.current.delete(legId);
    }
  }, []);

  // SHOULD-FIX 7: Compute "Book by" time for collection nodes
  const computeBookByTime = useCallback((): string | undefined => {
    const collLeg = schedule.legs.find(l => l.config.type === 'collection');
    if (!collLeg || collLeg.config.type !== 'collection') return undefined;
    const collTime = collLeg.config.pickupTimeMode === 'fixed'
      ? (collLeg.config.lockedCollectionTime || '17:00')
      : (collLeg.config.pickupWindowStart || '14:00');
    const [h, m] = collTime.split(':').map(Number);
    const collMinutes = h * 60 + (m || 0);
    const cutoffVal = schedule.operatingSchedule.cutoffValue;
    const cutoffUnit = schedule.operatingSchedule.cutoffUnit;
    const cutoffMinutes = cutoffUnit === 'hours' ? cutoffVal * 60 : cutoffUnit === 'days' ? cutoffVal * 1440 : cutoffVal;
    const bookByMin = ((collMinutes - cutoffMinutes) % 1440 + 1440) % 1440;
    return `${String(Math.floor(bookByMin / 60)).padStart(2, '0')}:${String(bookByMin % 60).padStart(2, '0')}`;
  }, [schedule]);

  const cutoffBookBy = computeBookByTime();

  const sortedLegs = [...schedule.legs].sort((a, b) => a.order - b.order);

  return (
    <div ref={containerRef} className="bg-white rounded-lg border border-border p-4" data-testid="chain-builder" aria-label="chain builder">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Delivery Route</h3>
        <p className="text-xs text-text-secondary">
          {lockedStructure
            ? 'Client override view: route structure is locked, editable override fields expand inline.'
            : readOnly ? 'Visual overview of the delivery journey' : 'Choose the first leg, then add or configure each route leg inline.'}
        </p>
      </div>

      {/* Route visualization */}
      <div className="space-y-2">
        {!readOnly && onAddLeg && sortedLegs.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-brand-cyan bg-brand-cyan/5 p-3" data-testid="start-leg-chooser">
            <div className="mb-3">
              <div className="text-sm font-semibold text-text-primary">Choose first leg</div>
              <div className="text-xs text-text-secondary">This start point becomes the first route leg after selection.</div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {legTypeOptions.map(({ type, label, icon: LegIcon }) => (
                <button
                  key={type}
                  onClick={() => onAddLeg(0, type)}
                  className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:border-brand-cyan hover:bg-surface-cream"
                >
                  <LegIcon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!readOnly && onAddLeg && sortedLegs.length > 0 && (
          <div className="relative flex justify-center" ref={addMenuFor === 0 ? addMenuRef : undefined}>
            <button
              onClick={() => setAddMenuFor(addMenuFor === 0 ? null : 0)}
              className="h-8 w-8 rounded-full bg-surface-cream border-2 border-dashed border-border
                       hover:bg-brand-cyan hover:border-brand-cyan hover:text-white
                       flex items-center justify-center transition-colors group"
              title="Insert first leg"
              aria-label="Insert first leg"
            >
              <Plus size={16} className="group-hover:text-white" />
            </button>
            {addMenuFor === 0 && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-white border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                {legTypeOptions.map(({ type, label, icon: LegIcon }) => (
                  <button
                    key={type}
                    onClick={() => { onAddLeg(0, type); setAddMenuFor(null); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface-cream transition-colors"
                  >
                    <LegIcon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Legs */}
        {sortedLegs.map((leg, index) => {
          const isFirstLeg = index === 0;
          const isLastLeg = index === sortedLegs.length - 1;
          const isSelected = leg.id === selectedLegId;

          return (
            <div key={leg.id} className="space-y-2">
              {/* Leg node */}
              <LegNode
                ref={setLegNodeRef(leg.id)}
                leg={leg}
                isSelected={isSelected}
                isFirstLeg={isFirstLeg}
                isLastLeg={isLastLeg}
                onClick={!readOnly ? () => onSelectLeg(leg.id, legNodeRefs.current.get(leg.id) ?? null) : undefined}
                onDelete={
                  !readOnly && onRemoveLeg
                    ? () => onRemoveLeg(leg.id)
                    : undefined
                }
                readOnly={readOnly}
                lockedStructure={lockedStructure}
                depots={depots}
                speeds={speeds}
                zones={zones}
                variant="row"
                cutoffBookBy={leg.config.type === 'collection' ? cutoffBookBy : undefined}
              >
                {!readOnly && onUpdateLeg && isSelected && (
                  <LegConfigPanel
                    leg={leg}
                    onUpdate={onUpdateLeg}
                    onClose={() => onSelectLeg(leg.id, legNodeRefs.current.get(leg.id) ?? null)}
                    inline
                    overrideMode={overrideMode}
                  />
                )}
              </LegNode>

              {!readOnly && onAddLeg && (
                  <div className="relative flex justify-center" ref={addMenuFor === leg.id ? addMenuRef : undefined}>
                    <button
                      onClick={() => setAddMenuFor(addMenuFor === leg.id ? null : leg.id)}
                      className="h-8 w-8 rounded-full bg-surface-cream border-2 border-dashed border-border
                               hover:bg-brand-cyan hover:border-brand-cyan hover:text-white
                               flex items-center justify-center transition-colors group"
                      title={isLastLeg ? 'Add leg after' : 'Add leg'}
                      aria-label={isLastLeg ? 'Add leg after' : 'Add leg'}
                    >
                      <Plus size={16} className="group-hover:text-white" />
                    </button>
                    {addMenuFor === leg.id && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-white border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                        {legTypeOptions.map(({ type, label, icon: LegIcon }) => (
                          <button
                            key={type}
                            onClick={() => { onAddLeg(leg.id, type); setAddMenuFor(null); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface-cream transition-colors"
                          >
                            <LegIcon size={14} />
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {sortedLegs.length === 0 && (
        <div className="text-center py-8 text-text-muted">
          <p className="text-sm mb-2">No route legs configured</p>
          <p className="text-xs">Choose Collection, Depot, Linehaul, or Delivery to create the first route leg.</p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-50 border border-blue-300"></div>
            <span className="text-text-secondary">Collection</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-gray-50 border border-gray-300"></div>
            <span className="text-text-secondary">Depot</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-orange-50 border border-orange-300"></div>
            <span className="text-text-secondary">Linehaul</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-50 border border-green-300"></div>
            <span className="text-text-secondary">Delivery</span>
          </div>
        </div>
      </div>
    </div>
  );
});
