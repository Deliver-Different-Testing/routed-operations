// Route-class chip: cyan First/Final Mile (Routes tab) vs purple Middle Mile
// (Linehaul tab). Constant per tab in v1 (Recurring Routes spec 6); becomes a
// filter control if the two list views ever merge to a single table.
export function RouteTypeChip({ kind }: { kind: 'first-final' | 'middle' }) {
  const isMiddle = kind === 'middle';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
      isMiddle ? 'bg-brand-purple/15 text-brand-purple' : 'bg-brand-cyan/15 text-brand-cyan'
    }`}>
      {isMiddle ? 'Middle Mile' : 'First/Final Mile'}
    </span>
  );
}
