import { Card } from '../components/common/Card';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const user = useAuth();
  return (
    <div className="h-full p-6 overflow-auto">
      <h1 className="text-2xl font-semibold text-text-primary mb-4">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="You">
          <div className="text-sm text-text-secondary">
            <div>Name: {user.fullName ?? 'Unknown'}</div>
            <div>Email: {user.email ?? 'Unknown'}</div>
            <div>Tenant: {user.currentTenantId ?? 'Unknown'}</div>
            <div>Region: {user.countryCode ?? 'Unknown'}</div>
          </div>
        </Card>

        <Card title="Route Builder">
          <p className="text-sm text-text-secondary">
            Head to <a href="/routes" className="text-brand-purple font-medium">Routes</a> to run the cockpit.
            This is the Stage 1 module; it reaches parity with the legacy RunBuilder.
          </p>
        </Card>

        <Card title="Later modules">
          <p className="text-sm text-text-secondary">
            Quoting, Scheduled Routes and Polygon Builder are scaffolded but not yet built.
            Dynamic mode arrives after batch parity ships.
          </p>
        </Card>
      </div>
    </div>
  );
}
