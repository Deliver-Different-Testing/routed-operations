// #333: suburb fixes remembered per client (tblBulkSuburbAlias). Mirrors
// BulkSuburbAliases.cs on the server; change both together, or a fix the
// wizard remembers is missed at booking (or the other way round).

import type { SuburbAliasDto } from '../../services/bulkImportService';

const ABBREVIATIONS: Record<string, string> = { mt: 'mount', st: 'saint', pt: 'point' };

// NFD minus non-spacing marks (\p{Mn}, the same set the server strips).
export function stripMarks(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}/gu, '');
}

// NFD minus diacritics, lower case, single spaces, dots read as spaces
// ('Mt.Eden'), Mt = Mount, St = Saint, Pt = Point.
export function normaliseSuburb(value: string | null | undefined): string {
  if (!value) return '';
  return stripMarks(value)
    .toLowerCase()
    .split(/[ .]/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(' ');
}

// Exact spelling bar diacritics, case, spacing and trailing dots: every
// run of spaces (tab, NBSP) is one space, then outer spaces and trailing
// dots go. An inner dot stays, so 'St. Albans' is not 'St Albans' and is
// still asked about when Saint Albans also exists. No abbreviation is
// expanded. Applied to the tucSuburb names and the sheet alike. Same rule
// as ExactKey in BulkSuburbAliases.cs.
function exactKey(value: string | null | undefined): string {
  return stripMarks(value ?? '')
    .toLowerCase()
    .replace(/[\p{Z}\t\n\r\f\v]+/gu, ' ')
    .replace(/^ +|[ .]+$/g, '');
}

// Exact spelling only. Checked BEFORE a remembered fix: alias keys are
// normalised, so a fix saved for 'St. Albans' must not capture a sheet
// 'St Albans', a real suburb. Same as BulkSuburbAliases.ExactSuburbMatcher.
export function buildExactSuburbMatcher(names: Iterable<string>): (raw: string) => string | undefined {
  const exact = new Map<string, string>();
  for (const name of names) {
    const ek = exactKey(name);
    if (ek && !exact.has(ek)) exact.set(ek, name);
  }
  return (raw) => {
    const ek = exactKey(raw);
    return ek ? exact.get(ek) : undefined;
  };
}

// Matches a sheet suburb to one of these names. The exact spelling wins;
// the normalised match ('Mt Eden' = 'Mount Eden') is used only when it
// points at a single name, so two real suburbs that normalise alike
// ('St Albans', 'Saint Albans') are never guessed between. Same rule as
// BulkSuburbAliases.SuburbMatcher on the server.
export function buildSuburbMatcher(names: Iterable<string>): (raw: string) => string | undefined {
  const exact = new Map<string, string>();
  const normalised = new Map<string, Set<string>>();
  for (const name of names) {
    if (!name || !name.trim()) continue;
    const ek = exactKey(name);
    if (!exact.has(ek)) exact.set(ek, name);
    const nk = normaliseSuburb(name);
    const set = normalised.get(nk) ?? new Set<string>();
    set.add(ek);
    normalised.set(nk, set);
  }
  return (raw) => {
    if (!raw || !raw.trim()) return undefined;
    const hit = exact.get(exactKey(raw));
    if (hit !== undefined) return hit;
    const set = normalised.get(normaliseSuburb(raw));
    return set && set.size === 1 ? exact.get([...set][0]) : undefined;
  };
}

// NZ: digits padded to 4 (Excel drops the leading zero). US: trimmed.
export function normalisePostCode(value: string | null | undefined, isNz: boolean): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (!isNz) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits ? digits.padStart(4, '0') : trimmed;
}

// Client postcode-specific, client postcode-less, then the same two
// tenant-wide (clientId null). Another client's rows never match.
export function findAlias(
  aliases: SuburbAliasDto[],
  clientId: number | null | undefined,
  suburb: string,
  postCode: string,
  isNz: boolean
): SuburbAliasDto | undefined {
  const key = normaliseSuburb(suburb);
  if (!key) return undefined;
  const pc = normalisePostCode(postCode, isNz);
  const rank = (a: SuburbAliasDto) => (a.clientId === null ? 2 : 0) + (a.rawPostCode === null ? 1 : 0);
  return aliases
    .filter((a) => a.rawSuburb === key && (a.rawPostCode === null || a.rawPostCode === pc))
    .filter((a) => a.clientId === null || a.clientId === clientId)
    .sort((a, b) => rank(a) - rank(b))[0];
}
