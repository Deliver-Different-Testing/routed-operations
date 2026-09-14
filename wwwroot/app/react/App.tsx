import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/Layout/AppLayout';
import Dashboard from './pages/Dashboard';
import RoutesPage from './pages/RoutesPage';
import Quoting from './pages/Quoting';
import ScheduledRoutes from './pages/ScheduledRoutes';
import RecurringRoutes from './pages/RecurringRoutes';
import Schedules from './pages/Schedules';
// Steve's 2026-09-08 brief: id-keyed multi-client Schedules view. Sits
// alongside the legacy tuple-keyed Schedules page above until ops sign
// off. Both routes read the same tblBulkRunSchedule day rows.
import SchedulesNew from './pages/SchedulesNew';
// Driver Scheduling module (2026-09-07 port from CourierManager). Sits
// adjacent to Schedules - different domain (courier availability rosters
// vs booking templates), different DB neighbourhood, different sidebar
// entry.
import DriverScheduling from './pages/DriverScheduling';
import PolygonBuilder from './pages/PolygonBuilder';
import AutoAssignLog from './pages/AutoAssignLog';
import BulkImport from './pages/BulkImport';
import HistoricArchive from './pages/HistoricArchive';
import RunViewer from './pages/route-viewer/RunViewer';
import ScanManager from './pages/route-viewer/ScanManager';
import PrintManager from './pages/route-viewer/PrintManager';
import CustomerServices from './pages/route-viewer/CustomerServices';
import Linehaul from './pages/route-viewer/Linehaul';
import Mobile from './pages/route-viewer/Mobile';

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
        <Route path="/historic-archive" element={<HistoricArchive />} />
        <Route path="/quoting" element={<Quoting />} />
        {/* Recurring Routes: merged 4-tab Configurator page (2026-08-12).
             The Routes tab body is delegated to ScheduledRoutes.tsx (kept
             imported above until that file is folded into RoutesTab.tsx). */}
        <Route path="/recurring-routes" element={<RecurringRoutes />} />
        {/* Schedules module (nightly booking templates + territory
             maintenance). Separate from Recurring Routes which lives on
             the Configurator Route entity. */}
        <Route path="/schedules" element={<Schedules />} />
        {/* Schedules NEW (2026-09-14 phase 1 target): id-keyed
             multi-client view. Sits alongside /schedules; both read the
             same day rows. Phase 1 shell today; wiring lands as the
             backend service + dbmigrationsv2 header + junction tables
             are added. */}
        <Route path="/schedules-new" element={<SchedulesNew />} />
        {/* Driver Scheduling module (2026-09-07) - operator-facing
             courier availability + time slots + SMS notifications. */}
        <Route path="/driver-scheduling" element={<DriverScheduling />} />
        <Route path="/polygon-builder" element={<PolygonBuilder />} />
        <Route path="/auto-assign-log" element={<AutoAssignLog />} />
        {/* Route Viewer module (2026-08-07). 6 sub-pages under /route-viewer/*.
             Placeholder shells today; feature builds land per P3+ of the build
             plan (Runviewer-migration-buildplan.md). */}
        <Route path="/route-viewer" element={<RunViewer />} />
        <Route path="/route-viewer/scans" element={<ScanManager />} />
        <Route path="/route-viewer/print" element={<PrintManager />} />
        <Route path="/route-viewer/cs" element={<CustomerServices />} />
        <Route path="/route-viewer/linehaul" element={<Linehaul />} />
        <Route path="/route-viewer/mobile" element={<Mobile />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
