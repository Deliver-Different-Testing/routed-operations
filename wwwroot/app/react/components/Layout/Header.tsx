import { useAuth } from '../../context/AuthContext';

export function Header() {
  const user = useAuth();
  return (
    <header className="h-14 bg-surface-white border-b border-border flex items-center justify-between px-4">
      <div className="text-sm text-text-secondary">
        {user.currentTenantId ? `Tenant ${user.currentTenantId}` : 'Not signed in'}
        {user.timeZone && <span className="ml-2 text-text-muted">- {user.timeZone}</span>}
      </div>
      <div className="text-sm text-text-primary">
        {user.fullName ?? user.email ?? ' '}
      </div>
    </header>
  );
}
