// Tenant-aware date formatting for Route Viewer. Legacy RunViewer used
// AngularJS `$filter('date')` with per-user locale detection; the target
// side uses `Intl.DateTimeFormat` so we do the same but hand it the
// tenant's IANA timezone rather than trusting the browser clock. This
// matters because operators triage jobs sitting in a different timezone
// from their own machine (a US NP dispatcher reviewing NZ pickups etc.)
// and the row's "Ready 09:00" needs to read as the depot's 09:00, not
// the operator's.
//
// Format contract:
//   US tenant: MM/dd/yyyy (short), MM/dd/yyyy h:mm a (long)
//   NZ / other: dd/MM/yyyy (short), dd/MM/yyyy HH:mm (long)
//   Missing tenant claim: default to US ordering per legacy behaviour.

import { windowsToIana } from './timezone';

interface TenantDateOptions {
  isUsTenant: boolean;
  /** Windows or IANA timezone string. Falls back to browser tz when null. */
  timeZone: string | null;
}

function normaliseTz(input: string | null): string | undefined {
  if (!input) return undefined;
  // Values coming from AWS SSM look like Windows names ("Pacific Standard
  // Time"); values coming from the tenant DB may already be IANA
  // ("America/Los_Angeles"). Intl.DateTimeFormat only accepts IANA.
  if (input.includes('/')) return input;
  return windowsToIana(input);
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short date. e.g. `05/08/2026` (NZ) or `08/05/2026` (US). */
export function tenantDate(
  value: Date | string | number | null | undefined,
  opts: TenantDateOptions,
): string {
  const d = toDate(value);
  if (!d) return '';
  const timeZone = normaliseTz(opts.timeZone);
  return new Intl.DateTimeFormat(opts.isUsTenant ? 'en-US' : 'en-NZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(d);
}

/** Long date + time. */
export function tenantDateTime(
  value: Date | string | number | null | undefined,
  opts: TenantDateOptions,
): string {
  const d = toDate(value);
  if (!d) return '';
  const timeZone = normaliseTz(opts.timeZone);
  return new Intl.DateTimeFormat(opts.isUsTenant ? 'en-US' : 'en-NZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: opts.isUsTenant,
    timeZone,
  }).format(d);
}

/** Time only, HH:mm. Used in the scanList box "Time" column. */
export function tenantTime(
  value: Date | string | number | null | undefined,
  opts: TenantDateOptions,
): string {
  const d = toDate(value);
  if (!d) return '';
  const timeZone = normaliseTz(opts.timeZone);
  return new Intl.DateTimeFormat(opts.isUsTenant ? 'en-US' : 'en-NZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: opts.isUsTenant,
    timeZone,
  }).format(d);
}

/** SP-emitted "dd/MM/yyyy" string re-formatter. RVW SPs use SQL
 *  CONVERT(..., 103) so wire values always arrive as `dd/MM/yyyy`
 *  regardless of tenant. This mirrors legacy filters.js `tenantDate`
 *  which detects the pre-formatted string and swaps digit order for US
 *  tenants rather than round-tripping through Date parsing. */
export function tenantDateFromSpString(
  input: string | null | undefined,
  isUsTenant: boolean,
): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m) return trimmed;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  return isUsTenant ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
}

/** SP-emitted "HH:mm:ss" or "HH:mm" string re-formatter. US tenants
 *  render as 12-hour "h:mm AM/PM"; NZ tenants strip the trailing
 *  ":ss" and keep 24-hour "HH:mm". Matches legacy `tenantDateTime`
 *  time-portion logic. */
export function tenantTimeFromSpString(
  input: string | null | undefined,
  isUsTenant: boolean,
): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!m) return trimmed;
  const hh = parseInt(m[1], 10);
  const mm = m[2];
  if (!isUsTenant) return `${hh.toString().padStart(2, '0')}:${mm}`;
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm} ${period}`;
}

/** ISO yyyy-MM-dd for the tenant's *today*. Used as the `pickDate` default
 *  filter value + as the `runDate` param on the initial run-list load. */
export function tenantTodayYmd(opts: TenantDateOptions): string {
  const timeZone = normaliseTz(opts.timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}
