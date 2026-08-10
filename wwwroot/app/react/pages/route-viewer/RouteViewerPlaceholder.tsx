// Shared placeholder shell for Route Viewer module pages. Each module
// (Run Viewer / Scan Manager / Print Manager / Customer Services /
// Linehaul / Mobile) renders this until its P3+ build phase lands.
// Keeps the sidebar navigable + the routes reachable without 404-ing
// on click during the interim.
import { Card } from '../../components/common/Card';
import { useAuth } from '../../context/AuthContext';

interface Props {
  title: string;
  buildPhase: string;
  summary: string;
  endpointsReady: string[];
}

export function RouteViewerPlaceholder({ title, buildPhase, summary, endpointsReady }: Props) {
  const user = useAuth();
  return (
    <div className="h-full p-6 overflow-auto">
      <div className="text-sm text-text-muted mb-6">
        Route Viewer module - frontend build pending ({buildPhase})
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl">
        <Card title="What lands here">
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{summary}</p>
        </Card>

        <Card title="Backend endpoints already live">
          <ul className="text-sm text-text-secondary space-y-1 font-mono">
            {endpointsReady.map((ep) => (
              <li key={ep} className="text-xs">{ep}</li>
            ))}
          </ul>
          <p className="text-xs text-text-muted mt-3">
            Hit any of these authenticated - they return real tenant data.
          </p>
        </Card>

        <Card title="Session context">
          <div className="text-sm text-text-secondary space-y-1">
            <div>Tenant: {user.currentTenantId ?? 'Unknown'} ({user.countryCode ?? '?'})</div>
            <div>Contact: {user.contactId ?? 'null'}</div>
            <div>Client: {user.clientId ?? 'null'}</div>
            <div>Client type: {user.clientTypeId ?? 'null'}</div>
            <div>NP scope: {user.isNetworkPartner ? `agent ${user.npAgentId ?? 'unresolved'}` : 'admin (tenant staff)'}</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
