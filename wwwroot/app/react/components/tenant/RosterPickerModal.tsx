import { useState } from 'react';
import { AssignTargetPicker, AssignTargetValue } from '@/components/common/AssignTargetPicker';
import { ModalCloseButton } from '@/components/common/ModalCloseButton';
import type { AssignableTargets } from '@/services/recurringRouteService';

// Small modal hosting the shared Courier/Agent/NP picker, with Save + an
// optional Clear (fall back to default). Shared by the Route roster and the
// Linehaul roster (Recurring Routes Fixes 6). `allowClear` controls whether the
// "Clear (use default)" affordance shows; the roster cell offers it so picking
// nothing falls back to the run/route default.
export function RosterPickerModal({
  title,
  targets,
  value,
  allowClear = true,
  onClose,
  onSave,
}: {
  title: string;
  targets: AssignableTargets | null;
  value: AssignTargetValue | null;
  allowClear?: boolean;
  onClose: () => void;
  onSave: (v: AssignTargetValue | null) => void;
}) {
  const [picked, setPicked] = useState<AssignTargetValue | null>(value);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#0d0c2c]">{title}</h3>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="px-5 py-5">
          <AssignTargetPicker targets={targets} value={picked} onChange={setPicked} />
        </div>
        <div className="px-5 py-3 border-t border-border bg-slate-50 flex items-center justify-between">
          {allowClear && value
            ? <button onClick={() => onSave(null)} className="text-[12.5px] text-text-secondary hover:text-red-600 font-medium">Clear (use default)</button>
            : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-[13px] text-text-secondary hover:text-[#0d0c2c] hover:bg-white rounded-full font-medium">Cancel</button>
            <button onClick={() => onSave(picked)} disabled={!picked}
              className="bg-brand-cyan text-[#0d0c2c] font-medium text-[13px] px-5 py-2 rounded-full disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed hover:shadow-cyan-glow transition-shadow">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
