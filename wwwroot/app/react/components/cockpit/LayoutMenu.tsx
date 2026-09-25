import { useState } from 'react';
import type { CockpitLayout } from '../../lib/layouts';
import { DEFAULT_LAYOUT } from '../../lib/layouts';
import { Button } from '../common/Button';

interface Props {
  layouts: CockpitLayout[];
  onSave: (name: string) => void;
  onLoad: (layout: CockpitLayout) => void;
  onDelete: (name: string) => void;
}

/**
 * Dropdown menu at the top of the cockpit for saving / loading / deleting
 * named panel layouts. Direct port of the legacy Save Layout / Load Layout
 * dropdown from homeView.html.
 */
export function LayoutMenu({ layouts, onSave, onLoad, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const commit = () => {
    const clean = name.trim();
    if (!clean) return;
    onSave(clean);
    setName('');
    setSaving(false);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        variant="neutral"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        active={open}
        title="Save or restore a panel layout"
      >
        Layout
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 min-w-56 bg-surface-white border border-border rounded shadow-lg z-40 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-border-light bg-surface-cream text-text-muted uppercase tracking-wide text-[10px]">
            Layouts
          </div>

          <button
            type="button"
            onClick={() => { onLoad(DEFAULT_LAYOUT); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 hover:bg-surface-cream"
          >
            Reset to default
          </button>

          {layouts.map((l) => (
            <div key={l.name} className="flex items-center border-t border-border-light">
              <button
                type="button"
                onClick={() => { onLoad(l); setOpen(false); }}
                className="flex-1 text-left px-3 py-1.5 hover:bg-surface-cream"
              >
                {l.name}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete layout "${l.name}"?`)) onDelete(l.name);
                }}
                className="px-2 py-1.5 text-error hover:bg-error-bg"
                title="Delete this layout"
              >
                x
              </button>
            </div>
          ))}

          <div className="border-t border-border-light bg-surface-cream">
            {saving ? (
              <div className="p-2 flex gap-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') { setSaving(false); setName(''); }
                  }}
                  placeholder="Layout name"
                  className="flex-1 border border-border rounded px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={commit}
                  className="px-2 py-1 bg-brand-cyan text-brand-dark rounded font-medium"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSaving(true)}
                className="w-full text-left px-3 py-1.5 hover:bg-surface-cream font-medium"
              >
                + Save current layout...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
