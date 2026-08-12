import { useCallback, useEffect, useMemo, useState } from 'react';
import { SpeedChip } from '@/components/tenant/SpeedChip';
import { ModalCloseButton } from '@/components/common/ModalCloseButton';
import { bulkJobService, BulkJobListItem, BulkJobDetail } from '@/services/bulkJobService';
import { extractLinehaulError } from '@/services/linehaulService';
import { rateScheduleService, ReportingSpeed } from '@/services/rateScheduleService';

// Mapped Stops drill-down (Recurring Routes spec 5). Right-side panel listing
// the jobs on a linehaul run OR a recurring route; each row opens the
// Job-detail modal where Speed is the only editable field.
//
// `source` decides the API path:
//   - 'run'   -> GET /api/recurring-linehaul-runs/{id}/jobs (Linehaul tab)
//   - 'route' -> GET /api/recurring-routes/{id}/jobs        (Routes tab)
export function MappedStopsDrilldown({
  run,
  source = 'run',
  onClose,
}: {
  run: { id: number; runName: string; fromDepotName: string; toDepotName: string };
  source?: 'run' | 'route';
  onClose: () => void;
}) {
  const [jobs, setJobs] = useState<BulkJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = source === 'route'
        ? await bulkJobService.listForRoute(run.id)
        : await bulkJobService.listForLinehaulRun(run.id);
      setJobs(list);
    } catch (e: unknown) {
      setError(extractLinehaulError(e, 'Failed to load jobs'));
    } finally {
      setLoading(false);
    }
  }, [run.id, source]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? jobs.filter((j) => j.jobNumber.toLowerCase().includes(q)) : jobs;
  }, [jobs, search]);

  const applySaved = (d: BulkJobDetail) => {
    setJobs((js) => js.map((j) => j.id === d.id
      ? { ...j, speedId: d.speedId, speedShortName: d.speedShortName, speedName: d.speedName, speedGroupingId: d.speedGroupingId, speedGroupingName: d.speedGroupingName }
      : j));
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-white h-full shadow-xl flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#0d0c2c]">Mapped Stops - {run.runName}</h2>
            <p className="text-[12px] text-text-secondary mt-0.5">{run.fromDepotName || '-'} to {run.toDepotName || '-'}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="px-6 py-3 border-b border-border">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search job #..."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-cyan focus:outline-none" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {loading ? (
            <div className="p-10 text-center text-sm text-text-secondary">Loading jobs...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-text-secondary">
              {jobs.length === 0 ? 'No jobs mapped to this run yet.' : 'No jobs match your search.'}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-surface-cream border-b border-border sticky top-0">
                <tr className="text-left text-[11px] font-semibold text-text-muted">
                  <th className="px-2 py-1.5">Job #</th>
                  <th className="px-2 py-1.5">Pickup</th>
                  <th className="px-2 py-1.5">Drop</th>
                  <th className="px-2 py-1.5">Speed</th>
                  <th className="px-2 py-1.5">Despatch</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((j) => (
                  <tr key={j.id} className="border-b border-border-light last:border-b-0 hover:bg-surface-cream cursor-pointer" onClick={() => setSelectedJobId(j.id)}>
                    <td className="px-2 py-1.5 font-medium text-brand-cyan">{j.jobNumber || '-'}</td>
                    <td className="px-2 py-1.5 text-text-secondary">{j.pickup || '-'}</td>
                    <td className="px-2 py-1.5 text-text-secondary">{j.drop || '-'}</td>
                    <td className="px-2 py-1.5"><SpeedChip shortName={j.speedShortName} name={j.speedName} groupingName={j.speedGroupingName} /></td>
                    <td className="px-2 py-1.5 text-text-secondary text-[10px]">{[j.bookDate, j.bookTime].filter(Boolean).join(' ') || '-'}</td>
                    <td className="px-2 py-1.5 text-text-secondary text-[10px]">{j.statusName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedJobId !== null && (
        <JobDetailModal jobId={selectedJobId} onClose={() => setSelectedJobId(null)} onSaved={applySaved} />
      )}
    </div>
  );
}

// Job detail modal - Speed is the only editable field (spec 5.2).
function JobDetailModal({
  jobId,
  onClose,
  onSaved,
}: {
  jobId: number;
  onClose: () => void;
  onSaved: (d: BulkJobDetail) => void;
}) {
  const [detail, setDetail] = useState<BulkJobDetail | null>(null);
  const [speeds, setSpeeds] = useState<ReportingSpeed[]>([]);
  const [speedId, setSpeedId] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [d, s] = await Promise.all([bulkJobService.getDetail(jobId), rateScheduleService.getSpeeds()]);
        if (!alive) return;
        setDetail(d);
        setSpeedId(d.speedId);
        setSpeeds(s.data);
      } catch (e: unknown) {
        if (alive) setErr(extractLinehaulError(e, 'Failed to load job'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  const grouped = useMemo(() => {
    const m = new Map<string, ReportingSpeed[]>();
    for (const s of speeds) {
      const key = s.groupingName ?? 'Other';
      (m.get(key) ?? m.set(key, []).get(key)!).push(s);
    }
    return [...m.entries()];
  }, [speeds]);

  const save = async () => {
    if (!detail) return;
    setSaving(true);
    setErr(null);
    try {
      const updated = await bulkJobService.updateSpeed(detail.id, speedId);
      setDetail(updated);
      onSaved(updated);
    } catch (e: unknown) {
      setErr(extractLinehaulError(e, 'Failed to update speed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#0d0c2c]">{detail ? `Job ${detail.jobNumber}` : 'Job'}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          {loading || !detail ? (
            <div className="py-8 text-center text-sm text-text-secondary">Loading...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Field label="Customer" value={detail.customer} />
                <Field label="Status" value={detail.statusName} />
                <Field label="Pickup" value={detail.pickupAddress} />
                <Field label="Drop" value={detail.dropAddress} />
                <Field label="Despatch" value={[detail.bookDate, detail.bookTime].filter(Boolean).join(' ')} />
                <Field label="Linehaul run" value={detail.linehaulRunName ?? '-'} />
              </div>

              <div>
                <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Speed (service level)</label>
                {detail.speedEditable ? (
                  <select value={speedId} onChange={(e) => setSpeedId(Number(e.target.value))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-brand-cyan focus:outline-none">
                    {grouped.map(([groupName, items]) => (
                      <optgroup key={groupName} label={groupName}>
                        {items.map((s) => <option key={s.id} value={s.id}>{s.shortName} - {s.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <div className="flex items-center gap-2">
                    <SpeedChip shortName={detail.speedShortName} name={detail.speedName} groupingName={detail.speedGroupingName} />
                    <span className="text-[12px] text-text-secondary">Locked - job is {detail.statusName.toLowerCase()}.</span>
                  </div>
                )}
              </div>

              {detail.notes && (
                <div>
                  <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Notes</label>
                  <p className="text-[13px] text-text-secondary whitespace-pre-wrap">{detail.notes}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-5 py-2 text-[13px] text-text-secondary hover:text-[#0d0c2c] hover:bg-white rounded-full font-medium">Close</button>
          {detail?.speedEditable && (
            <button onClick={save} disabled={saving || speedId === detail.speedId}
              className="bg-brand-cyan text-[#0d0c2c] font-medium text-[13px] px-5 py-2 rounded-full disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed hover:shadow-cyan-glow transition-shadow">
              {saving ? 'Saving...' : 'Save Speed'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-muted mb-0.5">{label}</div>
      <div className="text-sm text-text-primary">{value || '-'}</div>
    </div>
  );
}
