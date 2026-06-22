import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const vehicleTypes = ['Car', 'Van', 'Small Truck', 'Large Truck', 'Bike', 'EV — Cool', 'Walker'];

export default function SettingsDrawer({ open, onClose }: Props) {
  const [vehicle, setVehicle] = useState('Van');
  const [pkgSize, setPkgSize] = useState(2.5);
  const [windowMins, setWindowMins] = useState(120);
  const [maxRouteMins, setMaxRouteMins] = useState(180);
  const [maxJobs, setMaxJobs] = useState(25);
  const [maxKm, setMaxKm] = useState(150);
  const [returnToDepot, setReturnToDepot] = useState(true);
  const [respectColdChain, setRespectColdChain] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[2000] bg-black/30 transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <aside
        className={`fixed top-0 right-0 z-[2010] h-screen w-[340px] bg-white border-l border-gray-300 shadow-2xl flex flex-col transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="bg-gray-700 text-white px-4 py-2 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wide">⚙ Build Settings</span>
          <button onClick={onClose} className="hover:bg-white/10 px-2 rounded text-sm">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Vehicle</h3>
            <Field label="Vehicle type">
              <select value={vehicle} onChange={e => setVehicle(e.target.value)} className="w-full rounded border-gray-300 text-xs">
                {vehicleTypes.map(v => <option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Average package size (m³)">
              <input
                type="number" step="0.1" value={pkgSize}
                onChange={e => setPkgSize(parseFloat(e.target.value))}
                className="w-full rounded border-gray-300 text-xs"
              />
            </Field>
          </section>

          <hr className="border-gray-100" />

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Route Constraints</h3>
            <Field label="Time window per route (mins)">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={30} max={480} step={15} value={windowMins}
                  onChange={e => setWindowMins(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs font-semibold text-brand-dark w-12 text-right">{windowMins}m</span>
              </div>
            </Field>
            <Field label="Max route time (mins)">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={30} max={480} step={15} value={maxRouteMins}
                  onChange={e => setMaxRouteMins(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs font-semibold text-brand-dark w-12 text-right">{maxRouteMins}m</span>
              </div>
            </Field>
            <Field label="Max jobs per route">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={5} max={60} step={1} value={maxJobs}
                  onChange={e => setMaxJobs(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs font-semibold text-brand-dark w-12 text-right">{maxJobs}</span>
              </div>
            </Field>
            <Field label="Max distance per route (km)">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={20} max={500} step={10} value={maxKm}
                  onChange={e => setMaxKm(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs font-semibold text-brand-dark w-12 text-right">{maxKm}km</span>
              </div>
            </Field>
          </section>

          <hr className="border-gray-100" />

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Behaviour</h3>
            <Toggle k="Return to depot on last stop" v={returnToDepot} onChange={setReturnToDepot} />
            <Toggle k="Respect cold-chain constraints" v={respectColdChain} onChange={setRespectColdChain} />
          </section>

          <hr className="border-gray-100" />

          <section className="text-[10px] text-gray-500 leading-relaxed bg-gray-50 border border-gray-200 rounded p-2">
            Saved per tenant on <code className="bg-white px-1 rounded">tblBulkRunSetting</code>. The build engine reads max route time, route window, distance and load constraints on every Auto-Routing pass.
          </section>
        </div>

        <div className="border-t border-gray-200 px-4 py-2 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="text-xs px-3 py-1.5 text-gray-500 hover:text-brand-dark">Cancel</button>
          <button onClick={onClose} className="text-xs font-semibold bg-brand-cyan text-white px-4 py-1.5 rounded hover:brightness-110">Save</button>
        </div>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </div>
  );
}

function Toggle({ k, v, onChange }: { k: string; v: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer">
      <span className="text-xs text-brand-dark">{k}</span>
      <button
        type="button"
        onClick={() => onChange(!v)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${v ? 'bg-brand-cyan' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${v ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}
