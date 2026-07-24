import { NavLink } from 'react-router-dom';

const items = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/bulk-import', label: 'Bulk Import' },
  { to: '/routes', label: 'Routes' },
  { to: '/quoting', label: 'Quoting' },
  { to: '/scheduled-routes', label: 'Scheduled Routes' },
  { to: '/polygon-builder', label: 'Polygon Builder' },
];

export function Sidebar() {
  return (
    <aside className="w-56 bg-brand-dark text-white flex flex-col">
      <div className="px-4 py-4 text-lg font-semibold tracking-wide">Routed Operations</div>
      <nav className="flex-1 flex flex-col gap-1 px-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `px-3 py-2 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-brand-cyan text-brand-dark font-medium'
                  : 'text-white/80 hover:bg-white/10'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 text-xs text-white/50">Stage 1 - Route Builder</div>
    </aside>
  );
}
