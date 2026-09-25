import { useState } from 'react';

// Shared click-to-edit primitives for the Route Viewer Detail surface.
// Home (RvJobDetail) hosts the compact table layout; Mobile hosts the
// touch-first tap-to-edit row. Both share the same edit-on-click ->
// commit-on-blur/Enter / cancel-on-Escape state machine so behavior is
// consistent across surfaces. Two variants:
//
//   EditableInfoRow  - compact right-aligned string / number / select
//                      cell for the desktop Detail pane. Renders a
//                      plain InfoRow when readOnly.
//   EditableRow      - touch-first "large tap target" row for Mobile.
//                      Row label sits above the value; tap the entire
//                      value cell to enter edit mode. Handles all input
//                      types the mobile spec needs (text, number, date,
//                      textarea).
//
// Legacy reference: RunViewer\wwwroot\app\components\mobile\
//   mobileControl.js editDetailField() drove a modal dialog. Mobile
// this port renders inline so tap-to-edit stays on the same screen
// and does not lose scroll position (drivers work one-handed).

// -----------------------------------------------------------------
// InfoRow / EditableInfoRow (desktop Detail table)
// -----------------------------------------------------------------

export function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-sm">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-text-primary">
        {value || <span className="text-text-muted">-</span>}
      </span>
    </div>
  );
}

/** Click-to-edit variant of InfoRow. Click the value to swap to input;
 *  Enter to save, Escape to cancel. Empty-string save clears the field.
 *  When `readOnly` (LH-leg or non-internal client) renders as a plain
 *  InfoRow with no click-to-edit affordance. */
export function EditableInfoRow({
  label,
  value,
  onSave,
  readOnly,
}: {
  label: string;
  value: string | null | undefined;
  onSave: (v: string) => void | Promise<void>;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value ?? '');

  const commit = () => {
    setEditing(false);
    if (draft !== (value ?? '')) onSave(draft);
  };

  if (readOnly) return <InfoRow label={label} value={value} />;

  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-sm">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setEditing(false); setDraft(value ?? ''); }
          }}
          className="border border-brand-cyan rounded px-1 py-0 text-xs text-right w-32"
        />
      ) : (
        <span
          className="text-text-primary cursor-pointer border-b border-dashed border-transparent hover:border-brand-cyan"
          title="Click to edit"
          onClick={() => { setDraft(value ?? ''); setEditing(true); }}
        >
          {value || <span className="text-text-muted">-</span>}
        </span>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// EditableRow (touch-first Mobile surface)
// -----------------------------------------------------------------

export type EditableRowKind =
  | 'text'
  | 'number'
  | 'date'
  | 'textarea';

interface EditableRowProps {
  /** Label shown above the value. Kept short so the row stays compact. */
  label: string;
  /** Current value (already formatted for display). */
  displayValue: string;
  /** Raw string used to seed the editor. For date fields pass an
   *  ISO yyyy-MM-dd; for numbers pass the plain digit string. */
  editValue: string;
  /** Input variant. Defaults to 'text'. */
  kind?: EditableRowKind;
  /** Fires on commit (Enter / blur / date-picker change) with the new
   *  raw string. Caller parses to the appropriate typed patch. Optional
   *  because readOnly rows never fire it - keeping this required would
   *  force callers to pass a no-op noop function they never invoke. */
  onSave?: (raw: string) => void | Promise<void>;
  /** When true the row renders static (no tap affordance). Used for
   *  fields the backend cannot yet persist (WS_stpBulkJob_Update gap). */
  readOnly?: boolean;
  /** Optional tooltip shown on the static row when readOnly is true.
   *  Surfaces the "not yet editable" hint to Ops. */
  readOnlyReason?: string;
}

/** Touch-first tap-to-edit row for the Mobile surface. Larger tap
 *  target than EditableInfoRow so drivers can commit one-handed.
 *  Tap the value area to enter edit mode; Enter / blur commits, Escape
 *  cancels. Textarea variant commits on blur only (Enter inserts a
 *  newline). Date variant commits on picker change (no explicit save). */
export function EditableRow({
  label,
  displayValue,
  editValue,
  kind = 'text',
  onSave,
  readOnly,
  readOnlyReason,
}: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(editValue);

  // Commit gate matches the desktop primitive so a "no-op" edit (open,
  // close without typing) does not fire a save. Empty-string clears the
  // field. Guarded by onSave presence for future readOnly-but-editing
  // wiring safety (today readOnly short-circuits before this branch).
  const commit = () => {
    setEditing(false);
    if (draft !== editValue && onSave) onSave(draft);
  };

  const cancel = () => {
    setEditing(false);
    setDraft(editValue);
  };

  const shown = displayValue || '-';

  if (readOnly) {
    return (
      <div
        className="flex items-baseline gap-2"
        title={readOnlyReason}
      >
        <div className="w-20 text-xs text-text-muted flex-shrink-0">{label}</div>
        <div className="flex-1 text-text-primary">
          {displayValue || <span className="text-text-muted">-</span>}
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-baseline gap-2">
        <div className="w-20 text-xs text-text-muted flex-shrink-0">{label}</div>
        <button
          type="button"
          onClick={() => { setDraft(editValue); setEditing(true); }}
          aria-label={`Edit ${label}`}
          className="flex-1 text-left text-text-primary min-h-[36px] py-1 px-1 -mx-1 rounded hover:bg-black/5 active:bg-brand-cyan/10 border-b border-dashed border-transparent hover:border-brand-cyan"
          title={`Tap to edit ${label}`}
        >
          {displayValue || <span className="text-text-muted">-</span>}
          <span className="sr-only"> (current value: {shown})</span>
        </button>
      </div>
    );
  }

  // Editor variants share the same commit / cancel semantics; the
  // element they render differs.
  if (kind === 'textarea') {
    return (
      <div className="flex items-baseline gap-2">
        <div className="w-20 text-xs text-text-muted flex-shrink-0">{label}</div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
          }}
          rows={3}
          aria-label={`Edit ${label}`}
          className="flex-1 border border-brand-cyan rounded px-2 py-1 text-sm min-h-[72px]"
        />
      </div>
    );
  }

  const inputType = kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text';
  return (
    <div className="flex items-baseline gap-2">
      <div className="w-20 text-xs text-text-muted flex-shrink-0">{label}</div>
      <input
        autoFocus
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') cancel();
        }}
        aria-label={`Edit ${label}`}
        className="flex-1 border border-brand-cyan rounded px-2 py-1 text-sm min-h-[36px]"
        inputMode={kind === 'number' ? 'numeric' : undefined}
      />
    </div>
  );
}
