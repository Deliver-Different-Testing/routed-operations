// Speed (service-level) chip, coloured by job-type grouping (Recurring Routes
// spec 5.3). The spec keys colour off the grouping; since the grouping-id
// to category mapping isn't a stable contract across tenant DBs, we match the
// grouping NAME (Same-day = orange, Overnight = cyan, Linehaul = purple,
// everything else = slate).
function tone(groupingName: string | null): string {
  const g = (groupingName ?? '').toLowerCase();
  if (g.includes('same')) return 'bg-brand-orange/15 text-brand-orange';
  if (g.includes('overnight') || g.includes('over night')) return 'bg-brand-cyan/15 text-brand-cyan';
  if (g.includes('linehaul') || g.includes('line haul')) return 'bg-brand-purple/15 text-brand-purple';
  return 'bg-slate-100 text-slate-700';
}

export function SpeedChip({
  shortName,
  name,
  groupingName,
}: {
  shortName: string;
  name: string;
  groupingName: string | null;
}) {
  const label = shortName || name || '-';
  return (
    <span
      title={name || undefined}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tone(groupingName)}`}
    >
      {label}
    </span>
  );
}
