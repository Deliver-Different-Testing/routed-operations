import type { AssignTargetType } from '@/services/recurringRouteService';

// Small Courier / Agent / NP type chip. Shared by the Routes tab, the Linehaul
// tab default-target column, and both roster grids (Recurring Routes Fixes 5/6).
export function TargetTypeChip({ type }: { type: AssignTargetType }) {
  const label = type === 'NetworkPartner' ? 'NP' : type;
  const tone = type === 'Courier'
    ? 'bg-cyan-100 text-[#0d0c2c]'
    : type === 'Agent'
      ? 'bg-violet-100 text-violet-800'
      : 'bg-amber-100 text-amber-800';
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${tone}`}>{label}</span>;
}
