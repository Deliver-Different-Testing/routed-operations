import { useState } from 'react';
import type { FilterPreset } from '../../lib/filterPresets';
import { Button } from '../common/Button';

interface Props {
  presets: FilterPreset[];
  onSave: (name: string) => void;
  onLoad: (preset: FilterPreset) => void;
  onDelete: (name: string) => void;
}

/**
 * Filter preset dropdown - Plan §Phase 3 §7. Mirrors the LayoutMenu pattern
 * so operators find both in the same place. Persistence is localStorage;
 * server-side upgrade path is described in lib/filterPresets.ts.
 */
export function FilterPresetsMenu({ presets, onSave, onLoad, onDelete }: Props) {
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
        title="Save or recall a filter preset"
      >
        Presets
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 min-w-56 bg-surface-white border border-border rounded shadow-lg z-40 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-border-light bg-surface-cream text-text-muted uppercase tracking-wide text-[10px]">
            Filter Presets
          </div>

          {presets.length === 0 && (
            <div className="px-3 py-2 text-text-muted italic">No presets saved yet.</div>
          )}

          {presets.map((p) => (
            <div key={p.name} className="flex items-center border-t border-border-light">
              <button
                type="button"
                onClick={() => { onLoad(p); setOpen(false); }}
                className="flex-1 text-left px-3 py-1.5 hover:bg-surface-cream"
                title={`Regions: ${p.filters.regionIds.length}, Clients: ${p.filters.clientIds.length}, Speeds: ${p.filters.speeds.length}, OurRefs: ${p.filters.ourRefs.length}`}
              >
                {p.name}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete preset "${p.name}"?`)) onDelete(p.name);
                }}
                className="px-2 py-1.5 text-error hover:bg-error-bg"
                title="Delete this preset"
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
                  placeholder="Preset name"
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
                + Save current filters...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
