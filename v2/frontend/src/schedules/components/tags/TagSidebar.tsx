import type { ReactNode } from 'react';
import {
  ArrowRight,
  X,
  Check,
  Users,
  MapPin,
  Building2,
  DollarSign,
  Zap,
  Truck,
  Bell,
  Plane,
  Route,
  Globe
} from 'lucide-react';
import type { EntityConnections, SourceItem } from '../../modules/territory/types';
import { TAG_CATEGORIES } from '../../modules/territory/types';

// Map icon names to Lucide components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Users,
  MapPin,
  Building2,
  DollarSign,
  Zap,
  Truck,
  Bell,
  Plane,
  Route,
  Globe,
};

/**
 * TagSidebar - Connection Navigator
 *
 * Shows which OTHER parts of the system relate to the current item.
 * Displays connection status (✓/✗) per category with navigation.
 *
 * See TAG-SYSTEM-SPEC.md for full documentation.
 */

export interface TagSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sourceItem: SourceItem;
  connections: EntityConnections;
  onNavigate: (targetRoute: string, searchQuery: string) => void;
}

interface ConnectionRowProps {
  icon: string;
  label: string;
  connection: {
    hasConnections: boolean;
    count: number;
    connectionPath?: string;
  };
  onClick: () => void;
}

function ConnectionRow({ icon, label, connection, onClick }: ConnectionRowProps): ReactNode {
  const { hasConnections, count, connectionPath } = connection;
  const IconComponent = iconMap[icon];

  return (
    <div
      className={`flex items-center justify-between p-4 rounded-lg transition-all duration-200 ${
        hasConnections
          ? 'bg-brand-cyan/10 hover:bg-brand-cyan/20 cursor-pointer hover:shadow-sm'
          : 'bg-gray-50/50 opacity-60'
      }`}
      onClick={hasConnections ? onClick : undefined}
      role={hasConnections ? 'button' : undefined}
      tabIndex={hasConnections ? 0 : undefined}
      onKeyDown={hasConnections ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div className="flex items-center gap-3">
        {/* Category icon */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          hasConnections ? 'bg-brand-cyan/20' : 'bg-gray-200'
        }`}>
          {IconComponent && (
            <IconComponent className={`w-5 h-5 ${hasConnections ? 'text-brand-cyan' : 'text-gray-400'}`} />
          )}
        </div>

        {/* Category info */}
        <div>
          <div className="flex items-center gap-2">
            <span className={`font-medium ${hasConnections ? 'text-text-primary' : 'text-gray-400'}`}>
              {label}
            </span>
            {hasConnections && count > 0 && (
              <span className="text-sm font-medium text-brand-cyan">({count})</span>
            )}
          </div>
          {connectionPath && (
            <p className="text-xs text-text-secondary mt-0.5">{connectionPath}</p>
          )}
          {!hasConnections && (
            <p className="text-xs text-gray-400 mt-0.5">Not connected</p>
          )}
        </div>
      </div>

      {/* Status indicator + Navigation arrow */}
      <div className="flex items-center gap-2">
        {hasConnections ? (
          <>
            <Check className="w-4 h-4 text-success" />
            <ArrowRight className="w-4 h-4 text-brand-cyan" />
          </>
        ) : (
          <X className="w-4 h-4 text-gray-300" />
        )}
      </div>
    </div>
  );
}

export function TagSidebar({
  isOpen,
  onClose,
  sourceItem,
  connections,
  onNavigate,
}: TagSidebarProps): ReactNode {
  // Count connected and disconnected categories
  const connectedCount = Object.values(connections).filter(c => c.hasConnections).length;
  const totalCount = Object.keys(connections).length;

  const handleCategoryClick = (category: typeof TAG_CATEGORIES[0]) => {
    // Navigate to target page with search pre-filled
    const searchQuery = sourceItem.name;
    onNavigate(category.route, searchQuery);
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full w-96 bg-surface-white shadow-sidebar z-50 transition-transform duration-500 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="border-b border-border-light p-6">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Connections for:
              </h2>
              <p className="text-xl font-bold text-brand-dark mt-1">
                {sourceItem.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-secondary hover:text-text-primary hover:bg-gray-100 rounded transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-text-secondary">
            See which parts of the system this {sourceItem.type.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} relates to
          </p>
          <div className="mt-3 text-sm">
            <span className="text-brand-cyan font-medium">{connectedCount}</span>
            <span className="text-text-secondary"> of {totalCount} categories connected</span>
          </div>
        </div>

        {/* Connection List */}
        <div className="overflow-y-auto h-[calc(100%-180px)] p-4">
          <div className="space-y-2">
            {TAG_CATEGORIES.map((category) => {
              const connection = connections[category.id];
              // Skip the category that matches the source item type
              // (e.g., don't show "Zone Groups" when viewing a zone group)
              const sourceTypeMap: Record<string, string> = {
                zipZone: 'zoneGroups', // Zip zones are part of zone groups
                zoneGroup: 'zoneGroups',
                depot: 'depots',
                customer: 'customers',
                rateCard: 'rateCards',
                service: 'services',
              };
              if (sourceTypeMap[sourceItem.type] === category.id) {
                return null;
              }

              return (
                <ConnectionRow
                  key={category.id}
                  icon={category.icon}
                  label={category.label}
                  connection={connection}
                  onClick={() => handleCategoryClick(category)}
                />
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border-light bg-surface-white">
          <p className="text-xs text-text-secondary text-center">
            Click a connected category to navigate there with this item pre-searched
          </p>
        </div>
      </div>
    </>
  );
}
