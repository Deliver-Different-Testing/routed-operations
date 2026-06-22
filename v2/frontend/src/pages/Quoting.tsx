import { useState } from 'react';
import CockpitPage from '../components/CockpitPage';
import { mockJobs, mockGroupsDelivery, mockRunsDelivery, mockFleetsDelivery } from '../lib/mockData';

const deliveryJobs = mockJobs.filter(j => j.type === 'delivery');

interface QuoteSim {
  jobs: number;
  drivers: number;
  hours: number;
  cost: number;
  margin: number;
  quote: number;
}

const baseline: QuoteSim = {
  jobs: 240, drivers: 6, hours: 8.5, cost: 4180, margin: 22, quote: 5100,
};

export default function Quoting() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sim, setSim] = useState<QuoteSim | null>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFileName(f.name);
  };

  const runSim = () => {
    setRunning(true);
    setSim(null);
    setTimeout(() => {
      setSim(baseline);
      setRunning(false);
    }, 900);
  };

  return (
    <>
      {/* Quote summary band */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 shrink-0">
        <div className="flex items-stretch gap-3">
          <div className="flex-1 grid grid-cols-12 gap-3 items-center">
            <div className="col-span-3">
              <label className="border-2 border-dashed border-gray-300 rounded-lg px-3 py-2 text-center block cursor-pointer hover:border-brand-cyan transition">
                <input type="file" accept=".csv" onChange={onFile} className="hidden" />
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">1. Dataset (CSV)</div>
                <div className="text-xs font-medium text-brand-dark truncate">
                  {fileName ?? '📂 Drop CSV or click'}
                </div>
              </label>
            </div>

            <div className="col-span-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">2. Rate card</div>
              <select className="w-full text-xs rounded border-gray-300 py-1">
                <option>Standard medical — Zone A</option>
                <option>Pharma express</option>
                <option>Custom</option>
              </select>
            </div>

            <div className="col-span-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Service level</div>
              <select className="w-full text-xs rounded border-gray-300 py-1">
                <option>Same-day</option>
                <option>2-hour express</option>
              </select>
            </div>

            <div className="col-span-2">
              <button
                onClick={runSim}
                disabled={!fileName || running}
                className="w-full text-xs font-semibold bg-brand-dark text-white py-2 rounded hover:bg-brand-purple disabled:opacity-40"
              >
                {running ? 'Simulating…' : '3. Run simulation →'}
              </button>
            </div>

            <div className="col-span-3">
              {!sim ? (
                <div className="text-xs text-gray-400 italic">
                  Quote rows would land in <code className="bg-gray-100 px-1 rounded">tblQuoteJob</code> (shadow table).
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Recommended quote</div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-lg font-bold text-emerald-700">${sim.quote.toLocaleString()}</div>
                    <div className="text-[10px] text-emerald-600">{sim.margin}% margin · {sim.drivers} drivers · {sim.jobs} jobs</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reuse the same cockpit shape — uploaded jobs render here */}
      <CockpitPage
        title="Quoting"
        subtitle="Simulate route-build against a tblQuoteJob shadow set so the user can visualise deliveries on the map."
        jobs={deliveryJobs}
        groups={mockGroupsDelivery}
        runs={mockRunsDelivery}
        fleets={mockFleetsDelivery}
        mapCenter={[42.3601, -71.0589]}
        mapZoom={12}
      />
    </>
  );
}
