import { Link } from 'react-router-dom';
import Panel from '../components/Panel';
import { mockDrafts } from '../lib/mockData';

const stats = [
  { label: 'Jobs to assign',           value: '47', delta: '8 priority',    tone: 'attention' as const },
  { label: 'Drafts in progress',       value: '4',  delta: '2 auto-built',  tone: 'neutral'   as const },
  { label: 'Builds awaiting review',   value: '3',  delta: 'oldest 12m',    tone: 'attention' as const },
  { label: 'Auto-build queue',         value: '6',  delta: 'next 06:30',    tone: 'positive'  as const },
];

const features = [
  { to: '/routes', emoji: '📦', name: 'Route Building', desc: 'Batch + Dynamic route building in one cockpit. Pickups zip-match to runs automatically and dynamic mode reuses the scheduled-route board patterns.' },
  { to: '/quoting', emoji: '💰', name: 'Quoting', desc: 'NEW. Upload a dataset and route-build it on tblQuoteJob.' },
  { to: '/polygons', emoji: '🗺️', name: 'Polygon Builder', desc: 'NEW. Draw + save zones on a map.' },
];

const stateBadge: Record<string, string> = {
  'in-progress':     'bg-amber-100 text-amber-800',
  'awaiting-review': 'bg-blue-100 text-blue-800',
  'queued-to-build': 'bg-gray-100 text-gray-700',
};

export default function Dashboard() {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-brand-light">
      <div className="bg-white border-b border-gray-200 px-4 py-1.5 shrink-0 flex items-baseline gap-3">
        <h1 className="text-sm font-bold text-brand-dark">Dashboard</h1>
        <span className="text-[11px] text-gray-500">RouteBuilder = building. Monitoring lives in RunViewer.</span>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-1 p-1 min-h-0 overflow-auto">
        {/* Stat panels — sharp-corner despatchweb shape */}
        {stats.map(s => (
          <div key={s.label} className="col-span-3">
            <Panel title={s.label}>
              <div className="px-3 py-3">
                <div className="text-2xl font-bold text-brand-dark leading-none">{s.value}</div>
                <div className={`text-[10px] mt-1 ${s.tone === 'positive' ? 'text-emerald-600' : s.tone === 'attention' ? 'text-amber-600' : 'text-gray-500'}`}>
                  {s.delta}
                </div>
              </div>
            </Panel>
          </div>
        ))}

        {/* Active build drafts — full-width panel */}
        <div className="col-span-12">
          <Panel title="Active build drafts">
            <table className="w-full text-xs">
              <thead className="bg-gray-100">
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-2 py-1 font-medium">Draft</th>
                  <th className="px-2 py-1 font-medium">Type</th>
                  <th className="px-2 py-1 font-medium text-right">Jobs</th>
                  <th className="px-2 py-1 font-medium">Built by</th>
                  <th className="px-2 py-1 font-medium">State</th>
                  <th className="px-2 py-1 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mockDrafts.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-2 py-1 font-medium">{d.id} · {d.name}</td>
                    <td className="px-2 py-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        d.type === 'delivery' ? 'bg-blue-50 text-blue-700' :
                        d.type === 'pickup' ? 'bg-purple-50 text-purple-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>{d.type}</span>
                    </td>
                    <td className="px-2 py-1 text-right">{d.jobs}</td>
                    <td className="px-2 py-1 text-gray-600">{d.builtBy === 'auto-build' ? '⚡ auto' : '👤 dispatcher'}</td>
                    <td className="px-2 py-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${stateBadge[d.state]}`}>{d.state}</span>
                    </td>
                    <td className="px-2 py-1 text-gray-600 text-[10px]">{d.updatedMinsAgo}m ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-400 italic px-2 py-1 bg-gray-50 border-t border-gray-200">
              Once a draft is built + dispatched, it leaves this list — find it in RunViewer.
            </p>
          </Panel>
        </div>

        {/* Build surfaces panel — sharp-corner squared tiles */}
        <div className="col-span-12">
          <Panel title="Build surfaces in this mockup">
            <div className="grid grid-cols-3 gap-px bg-gray-200">
              {features.map(f => (
                <Link
                  key={f.to}
                  to={f.to}
                  className="bg-white p-3 hover:bg-amber-50 transition"
                >
                  <div className="text-xl mb-1">{f.emoji}</div>
                  <div className="text-xs font-semibold text-brand-dark">{f.name}</div>
                  <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">{f.desc}</p>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
