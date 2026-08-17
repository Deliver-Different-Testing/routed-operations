import { useState } from 'react';
import { Button } from '../common/Button';
import { LabelsSortPickerModal, type LabelsSortMode } from './LabelsSortPickerModal';
import { WoopReportDatePickerModal } from './WoopReportDatePickerModal';
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

export type PrintKind =
  | 'runAllocation'
  | 'missingScan'
  | 'missingRunScan'
  | 'missingTransitScan'
  | 'labels'
  | 'woop';

/** Extra payload attached to certain Print kinds:
 *  - `labels` carries the operator-picked sort mode from the
 *    Labels modal (Run Name / Product / Client).
 *  - `woop` carries the From/To date window picked in the Woop
 *    modal. Both dates are YYYY-MM-DD strings.
 *  Other kinds pass no payload. */
export type PrintPayload =
  | { sortMode: LabelsSortMode }
  | { fromDate: string; toDate: string }
  | undefined;

interface Props {
  onPrint: (kind: PrintKind, payload?: PrintPayload) => void;
  onTopUp: () => void;
  /** Current run date (YYYY-MM-DD) surfaced by the parent
   *  RvFilterBar. Used to seed the Woop modal's From/To inputs so a
   *  same-day export is one Download click away. */
  runDate: string;
  /** Callback that returns the current cockpit panel sizes at the
   *  moment Save-current fires. Kept as a callback (not a snapshot
   *  prop) so we always capture the LIVE arrangement rather than a
   *  stale react state value from an earlier render. */
  snapshotLayout: () => Pick<CockpitLayout, 'rvHorizontal' | 'rvLeftV' | 'rvMidV' | 'rvSlimV' | 'rvRightV'>;
  onApplyLayout: (layout: CockpitLayout) => void;
}

const PRINT_OPTIONS: Array<[PrintKind, string]> = [
  ['runAllocation', 'Run Allocation'],
  ['missingScan', 'Missing Scan'],
  ['missingRunScan', 'Missing Run Scan'],
  ['missingTransitScan', 'Missing Transit Scan'],
  ['labels', 'Labels'],
  ['woop', 'Woop Report'],
];

export function RvUtilityActions({ onPrint, onTopUp, runDate, snapshotLayout, onApplyLayout }: Props) {
  const [layouts, setLayoutsState] = useState<CockpitLayout[]>(() => loadLayouts('home'));
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [labelsModalOpen, setLabelsModalOpen] = useState(false);
  const [woopModalOpen, setWoopModalOpen] = useState(false);

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

  const pickPrintOption = (kind: PrintKind) => {
    setPrintOpen(false);
    // Labels + Woop route through a configuration modal so the
    // operator picks a sort mode / date range before the fetch fires.
    // Every other kind fires straight through with no payload.
    if (kind === 'labels') { setLabelsModalOpen(true); return; }
    if (kind === 'woop') { setWoopModalOpen(true); return; }
    onPrint(kind);
  };

  return (
    <>
      <div className="relative -mt-1">
        <Button variant="neutral" size="sm" onClick={() => setPrintOpen((v) => !v)}>Print ▾</Button>
        {printOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPrintOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 bg-surface-white text-text-primary border border-border rounded shadow-lg min-w-[10rem]">
              {PRINT_OPTIONS.map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => pickPrintOption(kind)}
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
      <div className="relative -mt-1">
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
      <LabelsSortPickerModal
        open={labelsModalOpen}
        onClose={() => setLabelsModalOpen(false)}
        onPrint={(sortMode) => onPrint('labels', { sortMode })}
      />
      <WoopReportDatePickerModal
        open={woopModalOpen}
        onClose={() => setWoopModalOpen(false)}
        onDownload={(fromDate, toDate) => onPrint('woop', { fromDate, toDate })}
        defaultDate={runDate}
      />
    </>
  );
}
