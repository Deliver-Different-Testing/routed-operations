import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import RoutesPage from './pages/RoutesPage';
import Quoting from './pages/Quoting';
import PolygonBuilder from './pages/PolygonBuilder';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="runs" element={<Navigate to="/routes" replace />} />
        <Route path="delivery-runs" element={<Navigate to="/routes" replace />} />
        <Route path="pickup-runs" element={<Navigate to="/routes" replace />} />
        <Route path="quoting" element={<Quoting />} />
        <Route path="scheduled-routes" element={<Navigate to="/routes?mode=dynamic" replace />} />
        <Route path="auto-build" element={<Navigate to="/routes?mode=dynamic" replace />} />
        <Route path="polygons" element={<PolygonBuilder />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
