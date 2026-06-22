import { NavLink, Outlet } from 'react-router-dom';

const nav = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/routes', label: 'Route Building', icon: '📦', end: false },
  { to: '/quoting', label: 'Quoting', icon: '💰', end: false, badge: 'NEW' },
  { to: '/polygons', label: 'Polygon Builder', icon: '🗺️', end: false, badge: 'NEW' },
];

export default function Shell() {
  return (
    <div className="h-screen flex bg-brand-light text-brand-dark overflow-hidden">
      <aside className="w-52 bg-brand-dark text-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛣️</span>
            <div>
              <div className="font-bold text-sm leading-tight">RouteBuilder</div>
              <div className="text-[9px] uppercase tracking-wider text-white/50">DFRNT mockup</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-2 space-y-0.5 overflow-y-auto">
          {nav.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 text-xs transition border-l-2 ${
                  isActive
                    ? 'bg-white/5 text-brand-cyan border-brand-cyan'
                    : 'text-white/70 hover:text-white hover:bg-white/5 border-transparent'
                }`
              }
            >
              <span className="text-sm w-4 text-center">{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {n.badge && (
                <span className="text-[8px] font-semibold bg-brand-cyan text-brand-dark px-1.5 py-0.5 rounded">
                  {n.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-2 border-t border-white/10 text-[9px] text-white/40 leading-relaxed">
          .NET 9 · React 19 · UI mockup
        </div>
      </aside>
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
