import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/Layout/AppLayout';
import Dashboard from './pages/Dashboard';
import RoutesPage from './pages/RoutesPage';
import Quoting from './pages/Quoting';
import ScheduledRoutes from './pages/ScheduledRoutes';
import PolygonBuilder from './pages/PolygonBuilder';
import BulkImport from './pages/BulkImport';

// Phase 6 perf note: route-level code splitting via React.lazy() was
// attempted but reverted - a Vite chunk-boundary interaction with
// useReducer inside the lazy-loaded RoutesPage triggered a "Rendered more
// hooks" error at first navigation despite resolve.dedupe being set.
// Root cause needs a deeper Vite/React investigation before re-enabling.
// The other Phase 6 wins (prod sourcemap off, modulepreload hint) are safe
// and stay in place. Followup on a dedicated branch.

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/bulk-import" element={<BulkImport />} />
        <Route path="/quoting" element={<Quoting />} />
        <Route path="/scheduled-routes" element={<ScheduledRoutes />} />
        <Route path="/polygon-builder" element={<PolygonBuilder />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
