import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssignableTarget, AssignableTargets, AssignTargetType } from '@/services/recurringRouteService';

// Inline Courier / Agent / NP picker. Mirrors the Configurator control:
// a type toggle + searchable dropdown filtered to the chosen type. NP = an
// agent with IsNetworkPartner = 1 (server-side split into targets.nps).

const TYPES: { key: AssignTargetType; label: string }[] = [
  { key: 'Courier', label: 'Courier' },
  { key: 'Agent', label: 'Agent' },
  { key: 'NetworkPartner', label: 'NP' },
];

const PLACEHOLDER: Record<AssignTargetType, string> = {
  Courier: 'Search courier...',
  Agent: 'Search agent...',
  NetworkPartner: 'Search Network Partner...',
};

export interface AssignTargetValue {
  type: AssignTargetType;
  id: number;
}

interface Props {
  targets: AssignableTargets | null;
  value: AssignTargetValue | null;
  onChange: (v: AssignTargetValue | null) => void;
}

export function AssignTargetPicker({ targets, value, onChange }: Props) {
  const [type, setType] = useState<AssignTargetType>(value?.type ?? 'Courier');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const list: AssignableTarget[] = useMemo(() => {
    if (!targets) return [];
    switch (type) {
      case 'Agent': return targets.agents;
      case 'NetworkPartner': return targets.nps;
      default: return targets.couriers;
    }
  }, [targets, type]);

  const selected = useMemo(
    () => (value && value.type === type ? list.find((t) => t.id === value.id) ?? null : null),
    [value, type, list],
  );

  useEffect(() => {
    setQuery(selected ? selected.name : '');
  }, [selected]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (selected && q === selected.name.toLowerCase())) return list;
    return list.filter((t) => t.name.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q));
  }, [query, list, selected]);

  const pickType = (t: AssignTargetType) => {
    if (t === type) return;
    setType(t);
    setQuery('');
    setOpen(true);
    onChange(null);
  };

  const pick = (t: AssignableTarget) => {
    onChange({ type, id: t.id });
    setQuery(t.name);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery('');
  };

  return (
    <div ref={boxRef}>
      <div className="flex gap-1 mb-2 rounded-lg border border-border bg-slate-50 p-1 w-fit">
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => pickType(t.key)}
            className={`rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors ${
              type === t.key ? 'bg-white text-[#0d0c2c] shadow-sm' : 'text-text-secondary hover:bg-white/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={PLACEHOLDER[type]}
          className="w-full border border-border rounded-lg px-3 py-2 pr-8 text-sm focus:ring-2 focus:ring-brand-cyan focus:outline-none"
        />
        {selected && (
          <button
            type="button"
            onClick={clear}
            title="Clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-red-600 text-lg leading-none"
          >x</button>
        )}
        {open && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {filtered.slice(0, 50).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t)}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-cyan-50 border-b border-border last:border-b-0 flex justify-between gap-2"
              >
                <span className="text-[#0d0c2c]">{t.name}</span>
                {t.hint && <span className="text-[11px] text-text-secondary self-center">{t.hint}</span>}
              </button>
            ))}
          </div>
        )}
        {open && targets && filtered.length === 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-border rounded-lg shadow-lg px-3 py-2 text-[12px] text-text-secondary">
            No {type === 'NetworkPartner' ? 'Network Partners' : type === 'Agent' ? 'agents' : 'couriers'} match.
          </div>
        )}
      </div>
    </div>
  );
}
