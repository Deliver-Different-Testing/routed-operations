// Windows-timezone -> IANA-timezone lookup. Small subset covering the
// tenant DB values Routed Operations actually sees today (NZ + AU + US
// timezones plus UTC). Full CLDR mapping is 500+ entries; keeping this
// tight so the bundle stays small. If a future tenant lands with an
// unmapped Windows name, add the row here rather than pulling in the
// whole CLDR JSON blob.
const MAP: Record<string, string> = {
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Samoa Standard Time': 'Pacific/Apia',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Tasmania Standard Time': 'Australia/Hobart',
  'AUS Central Standard Time': 'Australia/Darwin',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'W. Australia Standard Time': 'Australia/Perth',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'GMT Standard Time': 'Europe/London',
};

export function windowsToIana(windowsName: string): string {
  return MAP[windowsName] ?? windowsName;
}
