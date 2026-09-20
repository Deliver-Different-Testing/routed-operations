// src/modules/schedules/components/AttachClientsModal.tsx
//
// Search-and-tick picker used everywhere a client is attached to a schedule:
// the Clients tab, the table row action, a group's "Attach clients to group", and
// "Create override for a client" (single pick). Writes nothing itself — the caller
// applies the link rows through utils/clientLinks.

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import type { ClientReference } from '../types';

export interface AttachClientsModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  clients: ClientReference[];
  /** Reason a client cannot be picked (shown greyed with the reason), or null. */
  blockerFor?: (clientId: number) => string | null;
  /** Soft note shown beside a client that can still be picked. */
  noteFor?: (clientId: number) => string | null;
  /** Pick exactly one client (used for "create override"). */
  single?: boolean;
  confirmLabel?: string;
  onConfirm: (clientIds: number[]) => void;
  onClose: () => void;
}

export function AttachClientsModal({
  isOpen,
  title,
  subtitle,
  clients,
  blockerFor,
  noteFor,
  single = false,
  confirmLabel = 'Attach',
  onConfirm,
  onClose,
}: AttachClientsModalProps) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.shortName?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, search]);

  const toggle = (id: number, on: boolean) => {
    setPicked((prev) => {
      if (single) return new Set(on ? [id] : []);
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const close = () => {
    setPicked(new Set());
    setSearch('');
    onClose();
  };

  const confirm = () => {
    const ids = Array.from(picked);
    setPicked(new Set());
    setSearch('');
    onConfirm(ids);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={title}
      subtitle={subtitle}
      size="md"
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <span className="text-sm text-text-secondary">
            {picked.size ? `${picked.size} selected` : 'Nothing selected'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={confirm} disabled={picked.size === 0}>{confirmLabel}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3" data-testid="attach-clients-modal">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients by name or code…"
            aria-label="Search clients"
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-brand-cyan"
          />
        </div>
        <div className="border border-border rounded-lg max-h-80 overflow-y-auto divide-y divide-border">
          {filtered.map((c) => {
            const blocker = blockerFor?.(c.id) ?? null;
            const note = blocker ? null : noteFor?.(c.id) ?? null;
            const checked = picked.has(c.id);
            return (
              <label
                key={c.id}
                className={`flex items-center gap-3 px-3 py-2 text-sm ${blocker ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-surface-cream'}`}
              >
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name="attach-client"
                  disabled={!!blocker}
                  checked={checked}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                  className="border-border text-brand-cyan focus:ring-brand-cyan"
                />
                <span className="font-medium text-text-primary">{c.name}</span>
                <span className="text-xs text-text-muted">{c.shortName}</span>
                <span className="flex-1" />
                {(blocker || note) && (
                  <span className="text-xs text-text-secondary">{blocker || note}</span>
                )}
              </label>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-text-muted">No clients match.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
