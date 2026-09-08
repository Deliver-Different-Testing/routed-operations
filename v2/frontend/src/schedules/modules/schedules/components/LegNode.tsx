// src/modules/schedules/components/LegNode.tsx
import { forwardRef, type ReactNode } from 'react';
import { Package, Building2, Truck, MapPin, X, Pencil, ChevronDown, Lock } from 'lucide-react';
import type { LegType, ScheduleLeg, DepotReference, SpeedReference, ZoneReference } from '../types';

const SPEED_COLORS: Record<string, { bg: string; text: string }> = {
  'Same Day': { bg: 'bg-red-100', text: 'text-red-700' },
  'Next Day': { bg: 'bg-orange-100', text: 'text-orange-700' },
  'Economy': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  '2-Day': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  'Regional': { bg: 'bg-blue-100', text: 'text-blue-700' },
};

function getSpeedColor(speedName: string | undefined): { bg: string; text: string } {
  if (!speedName) return { bg: 'bg-gray-100', text: 'text-gray-500' };
  return SPEED_COLORS[speedName] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };
}

interface LegNodeProps {
  leg: ScheduleLeg;
  isSelected: boolean;
  isFirstLeg: boolean;
  isLastLeg: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
  depots: DepotReference[];
  speeds: SpeedReference[];
  zones: ZoneReference[];
  variant?: 'card' | 'row';
  lockedStructure?: boolean;
  /** SHOULD-FIX 7: Cutoff time string to display on Collection nodes, e.g. "15:00" */
  cutoffBookBy?: string;
  children?: ReactNode;
}

const LEG_TYPE_STYLES: Record<LegType, { bg: string; border: string; icon: typeof Package; iconColor: string }> = {
  collection: {
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    icon: Package,
    iconColor: 'text-blue-600',
  },
  depot: {
    bg: 'bg-gray-50',
    border: 'border-gray-300',
    icon: Building2,
    iconColor: 'text-gray-600',
  },
  linehaul: {
    bg: 'bg-orange-50',
    border: 'border-orange-300',
    icon: Truck,
    iconColor: 'text-orange-600',
  },
  delivery: {
    bg: 'bg-green-50',
    border: 'border-green-300',
    icon: MapPin,
    iconColor: 'text-green-600',
  },
};

export const LegNode = forwardRef<HTMLDivElement, LegNodeProps>(function LegNode(
  { leg, isSelected, onClick, onDelete, readOnly = false, depots, speeds, zones, variant = 'card', lockedStructure = false, cutoffBookBy, children },
  ref
) {
  const { config } = leg;
  const styles = LEG_TYPE_STYLES[config.type];
  const Icon = styles.icon;

  const getDisplayInfo = (): { title: string; subtitle: string; detail: string; speedBadge?: string } => {
    switch (config.type) {
      case 'collection': {
        const zoneNames = config.pickupZoneIds
          .map(zid => zones.find(z => z.id === zid)?.name || String(zid))
          .join(', ');
        const speedName = config.speedId
          ? speeds.find(s => s.id === config.speedId)?.name
          : undefined;
        const timeDisplay = config.pickupTimeMode === 'fixed'
          ? `Fixed ${config.lockedCollectionTime || '17:00'}`
          : `Window ${config.pickupWindowStart || '14:00'}–${config.pickupWindowEnd || '15:00'}`;
        return {
          title: 'Collection',
          subtitle: timeDisplay,
          detail: zoneNames || 'No zones',
          speedBadge: speedName,
        };
      }
      case 'depot': {
        const depot = depots.find(d => d.id === config.depotId);
        return {
          title: depot?.code || depot?.name || 'Unknown Depot',
          subtitle: 'Depot Stop',
          detail: config.storageState || 'ambient',
        };
      }
      case 'linehaul': {
        const fromDepot = config.fromDepotId ? depots.find(d => d.id === config.fromDepotId) : null;
        const toDepot = config.toDepotId ? depots.find(d => d.id === config.toDepotId) : null;
        const speedName = config.speedId
          ? speeds.find(s => s.id === config.speedId)?.name
          : undefined;
        const routeInfo = fromDepot && toDepot
          ? `${fromDepot.code || fromDepot.name} → ${toDepot.code || toDepot.name}`
          : 'No route';
        const daysText = config.activeDays.map(d => d.charAt(0).toUpperCase()).join('');
        return {
          title: 'Linehaul',
          subtitle: routeInfo,
          detail: `${config.transitMinutes}min · ${daysText || 'No days'}`,
          speedBadge: speedName,
        };
      }
      case 'delivery': {
        const delZoneNames = config.deliveryZoneIds
          .map(zid => zones.find(z => z.id === zid)?.name || String(zid))
          .join(', ');
        const speedName = config.speedId
          ? speeds.find(s => s.id === config.speedId)?.name
          : undefined;
        const driverText = config.courierId ? `Driver: #${config.courierId}` : 'Auto-assign';
        return {
          title: 'Delivery',
          subtitle: delZoneNames || 'No zones',
          detail: `${config.deliveryState || 'Standard'} · ${driverText}`,
          speedBadge: speedName,
        };
      }
    }
  };

  const info = getDisplayInfo();

  const rowVariant = variant === 'row';

  return (
    <div
      className={`
        relative group rounded-lg border-2 transition-all
        ${styles.bg} ${styles.border}
        ${lockedStructure ? 'border-dashed opacity-90 saturate-50' : ''}
        ${isSelected ? 'ring-2 ring-brand-cyan shadow-md' : 'hover:shadow-md'}
      `}
      ref={ref}
      data-testid="leg-node"
      aria-label="leg node"
    >
      <button
        onClick={onClick}
        className={`
          relative flex p-3 transition-all
          ${rowVariant ? 'w-full min-w-0 items-center gap-3 text-left' : 'flex-col items-center min-w-[160px]'}
          ${readOnly ? 'cursor-default' : 'cursor-pointer'}
        `}
        aria-expanded={rowVariant ? isSelected : undefined}
      >
        {/* Icon */}
        <div className={`${rowVariant ? 'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-white/70' : 'mb-2'} ${styles.iconColor}`}>
          <Icon size={rowVariant ? 22 : 24} />
        </div>

        <div className={rowVariant ? 'min-w-0 flex-1' : ''}>
          {/* Title */}
          <div className={`text-sm font-semibold text-text-primary ${rowVariant ? '' : 'text-center mb-1'}`}>
            {info.title}
          </div>

          {/* Subtitle */}
          <div className={`text-xs text-text-secondary line-clamp-2 ${rowVariant ? '' : 'text-center mb-1'}`}>
            {info.subtitle}
          </div>

          {/* Detail */}
          <div className={`text-xs text-text-muted ${rowVariant ? '' : 'text-center'}`}>
            {info.detail}
          </div>
        </div>

        <div className={`${rowVariant ? 'ml-auto flex flex-shrink-0 items-center gap-2' : 'flex flex-col items-center'}`}>
          {/* Speed Badge */}
          {info.speedBadge && (
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${rowVariant ? '' : 'mt-1'} ${getSpeedColor(info.speedBadge).bg} ${getSpeedColor(info.speedBadge).text}`}>
              {info.speedBadge}
            </div>
          )}

          {/* SHOULD-FIX 7: Cutoff badge on Collection node */}
          {config.type === 'collection' && cutoffBookBy && (
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200 ${rowVariant ? '' : 'mt-1'}`}>
              Book by {cutoffBookBy}
            </div>
          )}

          {lockedStructure && (
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/80 text-amber-700 border border-amber-200 ${rowVariant ? '' : 'mt-1'}`}>
              <Lock size={11} aria-hidden="true" />
              Structure locked
            </div>
          )}

          {rowVariant && !readOnly && (
            <ChevronDown
              size={18}
              className={`text-text-muted transition-transform ${isSelected ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          )}
        </div>

      </button>

      {/* Delete button */}
      {!readOnly && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full
                   opacity-0 group-hover:opacity-100 transition-opacity
                   flex items-center justify-center hover:bg-red-600"
          title="Remove leg"
          aria-label={`Remove ${info.title} leg`}
        >
          <X size={14} />
        </button>
      )}

      {isSelected && children && (
        <div className="border-t border-white/70 bg-white/70 p-3" data-testid="leg-node-expanded-settings">
          {children}
        </div>
      )}

      {/* Pencil icon on hover */}
      {!readOnly && !rowVariant && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Pencil size={12} className="text-text-muted" />
        </div>
      )}
    </div>
  );
});
