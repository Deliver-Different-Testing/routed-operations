interface Props {
  type: string | null | undefined;
  size?: 'sm' | 'md';
  isUsTenant?: boolean;
}

/**
 * ImportTypePill - the coloured chip rendered against every row in the
 * Bulk Import table. Cyan means the row was booked as on-demand (fires
 * WS_stpJob_Insert), grey means routed (goes onto a tblBulkJob run).
 * The server surfaces the raw string `type` as 'ondemand' or 'routed';
 * anything else falls through to a neutral badge. NZ tenants see the
 * routed rows labelled as "Scheduled".
 */
export function ImportTypePill({ type, size = 'md', isUsTenant = false }: Props) {
  const normalised = (type ?? '').toLowerCase();
  let label = 'Unknown';
  let colour = 'bg-border text-text-muted';
  if (normalised === 'ondemand' || normalised === 'on-demand') {
    label = 'On-Demand';
    colour = 'bg-brand-cyan/15 text-brand-dark border border-brand-cyan/40';
  } else if (normalised === 'routed') {
    label = isUsTenant ? 'Routed' : 'Scheduled';
    colour = 'bg-surface-cream text-text-secondary border border-border';
  }
  const sizing = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs';
  return (
    <span
      className={`inline-block rounded-full font-medium tracking-wide ${sizing} ${colour}`}
    >
      {label}
    </span>
  );
}
