import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/Layout/AppLayout';
import Dashboard from './pages/Dashboard';
import RoutesPage from './pages/RoutesPage';
import Quoting from './pages/Quoting';
import ScheduledRoutes from './pages/ScheduledRoutes';
import PolygonBuilder from './pages/PolygonBuilder';
import BulkImport from './pages/BulkImport';

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
