import { Outlet, useLocation } from 'react-router-dom';
import FeatureRoute from './FeatureRoute';
import { navItems } from './navItems';
import { routeGates } from '../../lib/accessSwitches';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function AppLayout() {
  const location = useLocation();
  // Mounted ONCE around the Outlet with the switches on the current route's
  // menu chain, read from the same tree the Sidebar renders.
  const requiredKeys = routeGates(location.pathname, navItems);
  return (
    <div className="h-screen flex bg-surface-light">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 min-h-0 overflow-hidden">
          <FeatureRoute requiredKeys={requiredKeys}>
            <Outlet />
          </FeatureRoute>
        </main>
      </div>
    </div>
  );
}
