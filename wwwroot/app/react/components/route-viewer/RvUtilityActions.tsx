import { useState } from 'react';
import { Button } from '../common/Button';
import {
  loadLayouts,
  saveLayouts,
  upsertLayout,
  deleteLayout,
  DEFAULT_LAYOUT,
  type CockpitLayout,
} from '../../lib/layouts';

// Right-side utility cluster for the Route Viewer top bar. Print
// dropdown, Top Up shortcut, Layout Save/Reset menu. Meant to be
// rendered as the `extraActions` slot on RvFilterBar so the whole top
// row (filters + these buttons) sits on one inline bar - matching the
// Routes cockpit chrome that has Refresh + Sync EH/HD on the same
// row. Search moved to the shared app Header; nothing here duplicates it.

interface Props {
  onPrint: (kind: 'runAllocation' | 'missingScan' | 'missingRunScan' | 'missingTransitScan' | 'woop') => void;
  onTopUp: () => void;
  /** Callback that returns the current cockpit panel sizes at the
   *  moment Save-current fires. Kept as a callback (not a snapshot
   *  prop) so we always capture the LIVE arrangement rather than a
   *  stale react state value from an earlier render. */
  snapshotLayout: () => Pick<CockpitLayout, 'rvHorizontal' | 'rvLeftV' | 'rvMidV' | 'rvSlimV' | 'rvRightV'>;
  onApplyLayout: (layout: CockpitLayout) => void;
}

const PRINT_OPTIONS: Array<[Parameters<Props['onPrint']>[0], string]> = [
  ['runAllocation', 'Run Allocation'],
  ['missingScan', 'Missing Scan'],
  ['missingRunScan', 'Missing Run Scan'],
  ['missingTransitScan', 'Missing Transit Scan'],
  ['woop', 'Woop Report'],
];

export function RvUtilityActions({ onPrint, onTopUp, snapshotLayout, onApplyLayout }: Props) {
  const [layouts, setLayoutsState] = useState<CockpitLayout[]>(() => loadLayouts('home'));
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const saveCurrent = () => {
    const name = window.prompt('Layout name');
    if (!name) return;
    const sizes = snapshotLayout();
    const next: CockpitLayout = { ...DEFAULT_LAYOUT, name, ...sizes };
    const updated = upsertLayout(layouts, next);
    setLayoutsState(updated);
    saveLayouts(updated, 'home');
    setLayoutOpen(false);
  };
  const removeLayout = (name: string) => {
    const updated = deleteLayout(layouts, name);
    setLayoutsState(updated);
    saveLayouts(updated, 'home');
  };

  return (
    <>
      <div className="relative">
        <Button variant="neutral" size="sm" onClick={() => setPrintOpen((v) => !v)}>Print ▾</Button>
        {printOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPrintOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 bg-surface-white text-text-primary border border-border rounded shadow-lg min-w-[10rem]">
              {PRINT_OPTIONS.map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => { onPrint(kind); setPrintOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-brand-cyan/10"
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <Button variant="neutral" size="sm" onClick={onTopUp}>Top Up</Button>
      <div className="relative">
        <Button variant="neutral" size="sm" onClick={() => setLayoutOpen((v) => !v)}>Layout ▾</Button>
        {layoutOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setLayoutOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 bg-surface-white text-text-primary border border-border rounded shadow-lg min-w-[14rem]">
              <button
                type="button"
                onClick={saveCurrent}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-brand-cyan/10 border-b border-border font-medium"
              >
                + Save current layout...
              </button>
              <button
                type="button"
                onClick={() => { onApplyLayout(DEFAULT_LAYOUT); setLayoutOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-brand-cyan/10 border-b border-border"
              >
                Reset to default
              </button>
              {layouts.length === 0 && (
                <div className="px-3 py-2 text-xs text-text-muted">No saved layouts.</div>
              )}
              {layouts.map((l) => (
                <div key={l.name} className="flex items-center border-b border-border/50">
                  <button
                    type="button"
                    onClick={() => { onApplyLayout(l); setLayoutOpen(false); }}
                    className="flex-1 text-left px-3 py-1.5 text-xs hover:bg-brand-cyan/10"
                  >
                    {l.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLayout(l.name)}
                    className="px-2 text-xs text-text-muted hover:text-error"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
