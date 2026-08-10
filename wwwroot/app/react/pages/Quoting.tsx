import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import { Card } from '../components/common/Card';
import {
  quoteService,
  type QuoteSetSummary,
  type QuoteJobUploadRow,
  type QuoteSimulateResult,
} from '../services/quoteService';

const RATE_CARDS = [
  { key: 'standard', label: 'Standard' },
  { key: 'premium', label: 'Premium' },
  { key: 'budget', label: 'Budget' },
];

const SERVICE_LEVELS = [
  { key: 'standard', label: 'Standard' },
  { key: 'express', label: 'Express (+15%)' },
  { key: 'same-day', label: 'Same-day (+25%)' },
];

/**
 * Quoting page. Upload a CSV of shadow jobs, pick a rate card + service
 * level + max stops per run, run a simulation to get a recommended quote.
 * All state lives in shadow tables (tblQuoteJob / tblQuoteRun) - operational
 * dispatch is never touched.
 *
 * Stage 2 - C.3. Simulation is a first-pass estimator; real HERE distance
 * matrix + tenant rate cards come later.
 */
export default function Quoting() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sets, setSets] = useState<QuoteSetSummary[]>([]);
  const [selectedSet, setSelectedSet] = useState<string | null>(null);
  const [csvText, setCsvText] = useState('');
  const [csvSetCode, setCsvSetCode] = useState('');
  const [uploading, setUploading] = useState(false);
  const [rateCard, setRateCard] = useState('standard');
  const [serviceLevel, setServiceLevel] = useState('standard');
  const [maxStops, setMaxStops] = useState(25);
  const [utilPct, setUtilPct] = useState(80);
  const [simulating, setSimulating] = useState(false);
  const [result, setResult] = useState<QuoteSimulateResult | null>(null);

  const loadSets = async () => {
    try {
      const res = await quoteService.getSets();
      setSets(res.response ?? []);
      if (selectedSet == null && res.response.length > 0) {
        setSelectedSet(res.response[0].quoteSetCode);
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };
  useEffect(() => { void loadSets(); }, []);

  const parsedRows = useMemo(() => parseCsv(csvText), [csvText]);

  const doUpload = async () => {
    if (!csvSetCode.trim()) { toast.show('Quote set code is required', 'error'); return; }
    if (parsedRows.length === 0) { toast.show('CSV parsed 0 rows', 'error'); return; }
    setUploading(true);
    try {
      const res = await quoteService.upload({
        quoteSetCode: csvSetCode.trim(),
        rows: parsedRows,
      });
      toast.show(`Uploaded ${res.response.rowsUploaded} rows into "${res.response.quoteSetCode}"`, 'success');
      setSelectedSet(res.response.quoteSetCode);
      setCsvText('');
      await loadSets();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const doSimulate = async () => {
    if (!selectedSet) { toast.show('Pick a quote set first', 'error'); return; }
    setSimulating(true);
    setResult(null);
    try {
      const res = await quoteService.simulate({
        quoteSetCode: selectedSet,
        rateCard,
        serviceLevel,
        maxStopsPerRun: maxStops,
        targetUtilisationPct: utilPct,
      });
      setResult(res.response);
      toast.show(`Recommended quote: $${res.response.recommendedQuote.toFixed(2)}`, 'success');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSimulating(false);
    }
  };

  const doDelete = async (code: string) => {
    const proceed = await confirm({
      title: 'Delete quote set',
      message: `Delete quote set "${code}" and its ${sets.find((s) => s.quoteSetCode === code)?.jobCount ?? '?'} rows?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!proceed) return;
    try {
      await quoteService.deleteSet(code);
      toast.show(`Quote set "${code}" deleted`, 'success');
      if (selectedSet === code) { setSelectedSet(null); setResult(null); }
      await loadSets();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
      if (!csvSetCode.trim()) {
        const nameNoExt = file.name.replace(/\.[^.]+$/, '');
        setCsvSetCode(nameNoExt);
      }
    } catch (err) {
      toast.show((err as Error).message, 'error');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <span className="text-text-muted">{sets.length} set{sets.length === 1 ? '' : 's'}</span>
        <div className="flex-1" />
        <Button variant="neutral" size="sm" onClick={loadSets}>Refresh</Button>
      </div>

      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="1. Upload shadow jobs">
          <div className="p-3 space-y-3 text-xs">
            <label className="block">
              <span className="block text-text-secondary mb-1">Quote set code</span>
              <input
                type="text"
                value={csvSetCode}
                onChange={(e) => setCsvSetCode(e.target.value)}
                placeholder="e.g. Acme-Q4-2026"
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="block text-text-secondary mb-1">CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={onFileChange}
                className="block text-xs"
              />
              <div className="mt-1 text-[10px] text-text-muted">
                Expected columns (header row): Customer, FromAddress, ToAddress, FromPostCode, ToPostCode, WeightKg, WindowStart, WindowEnd, IsPickup
              </div>
            </label>
            {csvText && (
              <label className="block">
                <span className="block text-text-secondary mb-1">
                  CSV preview ({parsedRows.length} row{parsedRows.length === 1 ? '' : 's'} parsed)
                </span>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={6}
                  className={INPUT_CLASS + ' font-mono text-[10px]'}
                />
              </label>
            )}
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={doUpload}
                disabled={uploading || !csvSetCode.trim() || parsedRows.length === 0}
              >
                {uploading ? 'Uploading...' : `Upload ${parsedRows.length} row(s)`}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="2. Configure + simulate">
          <div className="p-3 space-y-3 text-xs">
            <label className="block">
              <span className="block text-text-secondary mb-1">Quote set</span>
              <select
                value={selectedSet ?? ''}
                onChange={(e) => setSelectedSet(e.target.value || null)}
                className={INPUT_CLASS}
              >
                <option value="">- pick a set -</option>
                {sets.map((s) => (
                  <option key={s.quoteSetCode} value={s.quoteSetCode}>
                    {s.quoteSetCode} ({s.jobCount} jobs)
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-text-secondary mb-1">Rate card</span>
              <select value={rateCard} onChange={(e) => setRateCard(e.target.value)} className={INPUT_CLASS}>
                {RATE_CARDS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-text-secondary mb-1">Service level</span>
              <select value={serviceLevel} onChange={(e) => setServiceLevel(e.target.value)} className={INPUT_CLASS}>
                {SERVICE_LEVELS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-text-secondary mb-1">Max stops / run</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxStops}
                  onChange={(e) => setMaxStops(Math.max(1, Number(e.target.value)))}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="block text-text-secondary mb-1">Target utilisation %</span>
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={utilPct}
                  onChange={(e) => setUtilPct(Math.max(10, Math.min(100, Number(e.target.value))))}
                  className={INPUT_CLASS}
                />
              </label>
            </div>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={doSimulate}
                disabled={simulating || !selectedSet}
              >
                {simulating ? 'Simulating...' : 'Simulate'}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="3. Result" >
          <div className="p-3 text-xs">
            {!result && (
              <div className="text-text-muted italic">
                Upload a set and click Simulate to see cost + margin + recommended quote.
              </div>
            )}
            {result && (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Jobs in set" value={String(result.jobCount)} />
                <Stat label="Drivers required" value={String(result.driversRequired)} />
                <Stat label="Avg shift (h)" value={result.avgShiftHours.toFixed(1)} />
                <Stat label="Cost / job" value={`$${result.costPerJob.toFixed(2)}`} />
                <Stat label="Cost / km" value={`$${result.costPerKm.toFixed(2)}`} />
                <Stat label="Margin %" value={`${result.marginPct.toFixed(0)}%`} />
                <Stat label="Total cost" value={`$${result.totalCost.toFixed(2)}`} />
                <Stat label="Recommended quote" value={`$${result.recommendedQuote.toFixed(2)}`} highlight />
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Existing quote sets">
          <div className="p-3 text-xs">
            {sets.length === 0 && (
              <div className="text-text-muted italic">No quote sets yet.</div>
            )}
            <ul className="divide-y divide-border-light">
              {sets.map((s) => (
                <li key={s.quoteSetCode} className="flex items-center gap-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedSet(s.quoteSetCode)}
                    className={`flex-1 text-left px-2 py-0.5 rounded ${
                      selectedSet === s.quoteSetCode ? 'bg-brand-cyan/10 font-medium' : 'hover:bg-surface-cream'
                    }`}
                  >
                    <div>{s.quoteSetCode}</div>
                    <div className="text-[10px] text-text-muted">
                      {s.jobCount} job{s.jobCount === 1 ? '' : 's'}
                      {s.lastUploadedUtc && ` - uploaded ${new Date(s.lastUploadedUtc).toLocaleString('en-GB', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}`}
                    </div>
                  </button>
                  <Button variant="danger" size="sm" onClick={() => doDelete(s.quoteSetCode)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <div className="px-3 py-2">
        <Card>
          <div className="text-[11px] text-text-muted">
            Quote data is stored in shadow tables (<code>tblQuoteJob</code>, <code>tblQuoteRun</code>) and never
            promotes to <code>tblBulkJob</code> or <code>tucJob</code>. Simulation is a first-pass estimator; real
            HERE distance-matrix pricing arrives with the Dynamic mode planner.
          </div>
        </Card>
      </div>
    </div>
  );
}

const INPUT_CLASS = 'w-full border border-border rounded-lg px-3 py-1.5 text-sm bg-surface-white text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan';

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-2 rounded border ${highlight ? 'border-brand-cyan bg-brand-cyan/10' : 'border-border-light'}`}>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? 'text-brand-cyan' : 'text-text-primary'}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * Minimal CSV parser sufficient for the expected header shape. Handles
 * quoted fields (with embedded commas + escaped quotes) and skips blank
 * lines. Header row is used to map columns by name (case-insensitive) so
 * operators can rearrange the export.
 */
function parseCsv(text: string): QuoteJobUploadRow[] {
  if (!text.trim()) return [];
  const lines = splitLines(text);
  if (lines.length === 0) return [];
  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const iCustomer = idx('customer');
  const iFromAddress = idx('fromaddress');
  const iToAddress = idx('toaddress');
  const iFromPost = idx('frompostcode');
  const iToPost = idx('topostcode');
  const iWeight = idx('weightkg');
  const iWinS = idx('windowstart');
  const iWinE = idx('windowend');
  const iPickup = idx('ispickup');

  const rows: QuoteJobUploadRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseLine(lines[li]);
    if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) continue;
    const readNum = (i: number): number | null => {
      if (i < 0) return null;
      const v = cells[i]?.trim();
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const readTime = (i: number): string | null => {
      if (i < 0) return null;
      const v = cells[i]?.trim();
      if (!v) return null;
      if (/^\d{2}:\d{2}$/.test(v)) return v + ':00';
      if (/^\d{2}:\d{2}:\d{2}$/.test(v)) return v;
      return null;
    };
    const readBool = (i: number): boolean => {
      if (i < 0) return false;
      const v = (cells[i] ?? '').trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes' || v === 'pickup';
    };
    const readStr = (i: number): string | null => {
      if (i < 0) return null;
      const v = cells[i]?.trim();
      return v ? v : null;
    };
    rows.push({
      customer: readStr(iCustomer),
      fromAddress: readStr(iFromAddress),
      toAddress: readStr(iToAddress),
      fromPostCode: readNum(iFromPost),
      toPostCode: readNum(iToPost),
      weightKg: readNum(iWeight),
      windowStart: readTime(iWinS),
      windowEnd: readTime(iWinE),
      isPickup: readBool(iPickup),
    });
  }
  return rows;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
