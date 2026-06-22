export interface Job {
  id: string;
  source: 'tblBulkJob' | 'tucJob' | 'tucJobBooking';
  customer: string;
  pickup: string;
  delivery: string;
  weightKg: number;
  windowStart: string;
  windowEnd: string;
  type: 'delivery' | 'pickup';
  readyAt: string;
  client?: string;
  jobNo?: string;
  dDate?: string;
  rTime?: string;
  suburb?: string;
  zipCode?: string;
  courier?: string;
  runId?: string;
  lat?: number;
  lng?: number;
}

export interface JobGroup { readyAt: string; count: number }
export interface Run {
  id: string;
  area: string;
  jobs: number;
  mins: number;
  km: number;
  marginPct: number;
  courier?: string;
  color: string;
}
export interface Fleet { name: string }
export interface Courier { id: string; name: string; fleet: string; status: 'available' | 'on-run' | 'off' }

export const mockJobs: Job[] = [
  { id: 'J-10042', source: 'tblBulkJob', customer: 'Zimmer Biomet', client: 'WOOP', jobNo: 'WC8800318DEL', pickup: 'South Boston', delivery: 'Fangwei Xiao, 142 Charles St', weightKg: 12, windowStart: '08:00', windowEnd: '10:00', readyAt: '04:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'Beacon Hill', zipCode: '02108', courier: 'Beacon', runId: 'bos1', lat: 42.3587, lng: -71.0678 },
  { id: 'J-10043', source: 'tblBulkJob', customer: 'Stryker', client: 'WOOP', jobNo: 'WC8800579DEL', pickup: 'South Boston', delivery: 'Sarah Brown, 3 Commercial Wharf', weightKg: 18, windowStart: '09:00', windowEnd: '11:00', readyAt: '07:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'North End', zipCode: '02109', courier: 'Beacon', runId: 'bos1', lat: 42.3630, lng: -71.0529 },
  { id: 'J-10044', source: 'tucJob', customer: 'Fonterra', client: 'WOOP', jobNo: 'WC8800170DEL', pickup: 'Cambridge', delivery: 'Rebekah Miller, 4A Dartmouth St', weightKg: 45, windowStart: '10:00', windowEnd: '12:00', readyAt: '07:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'South End', zipCode: '02116', courier: 'South', runId: 'bos2', lat: 42.3466, lng: -71.0756 },
  { id: 'J-10045', source: 'tucJob', customer: 'NuVasive', client: 'WOOP', jobNo: 'WC8800558DEL', pickup: 'Logan Airport', delivery: 'Karen Kaller, 8 G St', weightKg: 8, windowStart: '07:30', windowEnd: '09:30', readyAt: '12:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'South Boston', zipCode: '02127', courier: 'Seaport', runId: 'bos3', lat: 42.3376, lng: -71.0418 },
  { id: 'J-10046', source: 'tucJobBooking', customer: 'Roche Diagnostics', client: 'FARON', jobNo: 'E8797SHDEL', pickup: 'Cambridge', delivery: 'Anna Bouterey, 1 Lewis Wharf', weightKg: 6, windowStart: '11:00', windowEnd: '13:00', readyAt: '07:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'North End', zipCode: '02109', courier: 'Beacon', runId: 'bos1', lat: 42.3662, lng: -71.0504 },
  { id: 'J-10047', source: 'tblBulkJob', customer: 'Pharma Express', client: 'WOOP', jobNo: 'WC8801142DEL', pickup: 'Dorchester', delivery: 'Lisa Barr, 67 Seaport Blvd', weightKg: 22, windowStart: '13:00', windowEnd: '15:00', readyAt: '12:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'Seaport', zipCode: '02210', runId: 'bos4', lat: 42.3488, lng: -71.0402 },
  { id: 'J-10048', source: 'tucJob', customer: 'B. Braun', client: 'WOOP', jobNo: 'WC8800700DEL', pickup: 'Somerville', delivery: 'Chris Cooper, 14 Maverick Sq', weightKg: 14, windowStart: '14:00', windowEnd: '16:00', readyAt: '13:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'East Boston', zipCode: '02128', lat: 42.3692, lng: -71.0395 },
  { id: 'J-10049', source: 'tblBulkJob', customer: 'AC Pharma', client: 'WOOP', jobNo: 'WC8801201DEL', pickup: 'South Boston', delivery: 'Riverside Medical, Charlestown Navy Yard', weightKg: 5, windowStart: '13:30', windowEnd: '15:30', readyAt: '13:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'Charlestown', zipCode: '02129', lat: 42.3781, lng: -71.0517 },
  { id: 'J-10050', source: 'tucJob', customer: 'Medical Direct', client: 'WOOP', jobNo: 'WC8801308DEL', pickup: 'Roxbury', delivery: 'Back Bay Clinic', weightKg: 11, windowStart: '15:00', windowEnd: '17:00', readyAt: '18:00', type: 'delivery', dDate: '15/06/2026', rTime: '12:00:00', suburb: 'Back Bay', zipCode: '02116', lat: 42.3503, lng: -71.0810 },
  // Pickups in Boston — by-zip auto-match to delivery runs; East Boston + Charlestown remain unmatched and render grey.
  { id: 'P-20011', source: 'tucJobBooking', customer: 'South End Pharmacy', client: 'WOOP', jobNo: 'WC8810011PCK', pickup: 'South End, 8 Columbus Ave', delivery: 'Depot', weightKg: 8, windowStart: '14:00', windowEnd: '16:00', readyAt: '14:00', type: 'pickup', dDate: '15/06/2026', rTime: '14:00:00', suburb: 'South End', zipCode: '02116', lat: 42.3448, lng: -71.0766 },
  { id: 'P-20012', source: 'tucJobBooking', customer: 'Beacon Hill Clinic', client: 'WOOP', jobNo: 'WC8810012PCK', pickup: 'Beacon Hill, 24 Cambridge St', delivery: 'Depot', weightKg: 4, windowStart: '14:30', windowEnd: '16:30', readyAt: '14:00', type: 'pickup', dDate: '15/06/2026', rTime: '14:30:00', suburb: 'Beacon Hill', zipCode: '02108', lat: 42.3599, lng: -71.0646 },
  { id: 'P-20013', source: 'tucJob', customer: 'North End Vet', client: 'WOOP', jobNo: 'WC8810013PCK', pickup: 'North End, 12 Salem St', delivery: 'Depot', weightKg: 6, windowStart: '15:00', windowEnd: '17:00', readyAt: '15:00', type: 'pickup', dDate: '15/06/2026', rTime: '15:00:00', suburb: 'North End', zipCode: '02109', lat: 42.3641, lng: -71.0550 },
  { id: 'P-20014', source: 'tucJob', customer: 'Eastie Surf Co.', client: 'FARON', jobNo: 'E8810014PCK', pickup: 'East Boston, 42 Maverick St', delivery: 'Depot', weightKg: 3, windowStart: '15:30', windowEnd: '17:30', readyAt: '15:00', type: 'pickup', dDate: '15/06/2026', rTime: '15:30:00', suburb: 'East Boston', zipCode: '02128', lat: 42.3706, lng: -71.0335 },
  { id: 'P-20015', source: 'tucJobBooking', customer: 'Charlestown Cheese', client: 'WOOP', jobNo: 'WC8810015PCK', pickup: 'Charlestown, 1 Main St', delivery: 'Depot', weightKg: 12, windowStart: '16:00', windowEnd: '18:00', readyAt: '16:00', type: 'pickup', dDate: '15/06/2026', rTime: '16:00:00', suburb: 'Charlestown', zipCode: '02129', lat: 42.3733, lng: -71.0603 },
];

export const mockGroupsDelivery: JobGroup[] = [
  { readyAt: '04:00', count: 6 },
  { readyAt: '07:00', count: 30 },
  { readyAt: '12:00', count: 20 },
  { readyAt: '12:30', count: 3 },
  { readyAt: '13:00', count: 1 },
  { readyAt: '18:00', count: 2 },
];

export const mockGroupsPickup: JobGroup[] = [
  { readyAt: '14:00', count: 4 },
  { readyAt: '15:00', count: 9 },
  { readyAt: '16:00', count: 5 },
  { readyAt: '17:00', count: 2 },
];

export const mockRunsDelivery: Run[] = [
  { id: 'bos1', area: 'BOS1 02108, 02109', jobs: 16, mins: 74, km: 18.4, marginPct: 29.2, courier: 'Beacon', color: '#ef4444' },
  { id: 'bos2', area: 'BOS2 02116', jobs: 11, mins: 58, km: 14.7, marginPct: 27.1, courier: 'South', color: '#3b82f6' },
  { id: 'bos3', area: 'BOS3 02127', jobs: 9, mins: 63, km: 16.2, marginPct: 25.8, courier: 'Seaport', color: '#10b981' },
  { id: 'bos4', area: 'BOS4 02210', jobs: 7, mins: 49, km: 12.6, marginPct: 24.6, courier: 'Unassigned', color: '#f59e0b' },
];

export const mockRunsPickup: Run[] = [
  { id: 'PCK1', area: 'Auckland CBD + Newmarket return', jobs: 9, mins: 92, km: 41.5, marginPct: 24.5, courier: 'Sione T.', color: '#8b5cf6' },
  { id: 'PCK2', area: 'Penrose + Airport return', jobs: 5, mins: 47, km: 22.1, marginPct: 22.8, courier: 'Unassigned', color: '#a855f7' },
];

export const mockFleetsDelivery: Fleet[] = [
  { name: 'Truck Channel' }, { name: 'Main Channel' }, { name: 'City Channel' },
  { name: 'Map Plan Run' }, { name: 'Regional' }, { name: 'Auckland Cool' },
  { name: 'Halls' }, { name: 'Agent' },
];

export const mockFleetsPickup: Fleet[] = [
  { name: 'Pickup Express' }, { name: 'Depot Returns' }, { name: 'Agent' },
];

export const mockCouriersByFleet: Record<string, Courier[]> = {
  'Truck Channel': [
    { id: 'C-101', name: 'Sione T.', fleet: 'Truck Channel', status: 'on-run' },
    { id: 'C-102', name: 'Karen M.', fleet: 'Truck Channel', status: 'available' },
    { id: 'C-103', name: 'David L.', fleet: 'Truck Channel', status: 'available' },
  ],
  'Main Channel': [
    { id: 'C-201', name: 'Aroha W.', fleet: 'Main Channel', status: 'available' },
    { id: 'C-202', name: 'Hēmi P.', fleet: 'Main Channel', status: 'on-run' },
  ],
  'City Channel': [],
  'Map Plan Run': [],
  'Regional': [],
  'Auckland Cool': [],
  'Halls': [],
  'Agent': [],
  'Pickup Express': [
    { id: 'C-501', name: 'Tom K.', fleet: 'Pickup Express', status: 'available' },
    { id: 'C-502', name: 'Ngaire B.', fleet: 'Pickup Express', status: 'available' },
  ],
  'Depot Returns': [
    { id: 'C-601', name: 'Sam R.', fleet: 'Depot Returns', status: 'on-run' },
  ],
};

export const mockPolygons = [
  { id: 'PG-01', name: 'Auckland CBD Inner', points: 6, jobsLast30Days: 412, color: '#3bc7f4' },
  { id: 'PG-02', name: 'East Tamaki Industrial', points: 8, jobsLast30Days: 287, color: '#606DB4' },
  { id: 'PG-03', name: 'North Shore Medical Corridor', points: 7, jobsLast30Days: 198, color: '#10b981' },
  { id: 'PG-04', name: 'Airport Express Zone', points: 5, jobsLast30Days: 156, color: '#f59e0b' },
];

export interface RecurringRoute {
  id: string;
  name: string;
  frequency: string;
  timeWindow: string;
  avgJobs: number;
  lastBuilt: string;
  live: boolean;
  color: string;
  zips: string[];
}

export const mockRecurringRoutes: RecurringRoute[] = [
  { id: 'RR-101', name: 'Beacon Hill AM Med', frequency: 'Mon–Fri', timeWindow: '07:00–09:00', avgJobs: 8, lastBuilt: 'Yesterday 07:32', live: true, color: '#ef4444', zips: ['02108', '02109'] },
  { id: 'RR-102', name: 'South End Medical Loop', frequency: 'Mon–Fri', timeWindow: '06:30–08:30', avgJobs: 6, lastBuilt: 'Yesterday 07:30', live: true, color: '#3b82f6', zips: ['02116'] },
  { id: 'RR-103', name: 'Eastie / Charlestown Run', frequency: 'Tue, Thu', timeWindow: '10:00–14:00', avgJobs: 3, lastBuilt: '2 days ago 09:01', live: true, color: '#10b981', zips: ['02128', '02129'] },
  { id: 'RR-104', name: 'PM Seaport Loop', frequency: 'Daily', timeWindow: '12:30–14:30', avgJobs: 9, lastBuilt: 'Yesterday 12:30', live: true, color: '#f59e0b', zips: ['02210', '02127'] },
];

// Approximate zip polygons (mockup) keyed by Boston zip code
export const zipPolygons: Record<string, [number, number][]> = {
  '02108': [[42.3548, -71.0728], [42.3562, -71.0618], [42.3614, -71.0608], [42.3624, -71.0692], [42.3583, -71.0745]],
  '02109': [[42.3604, -71.0588], [42.3612, -71.0479], [42.3674, -71.0469], [42.3682, -71.0551], [42.3640, -71.0604]],
  '02116': [[42.3432, -71.0858], [42.3441, -71.0702], [42.3515, -71.0693], [42.3520, -71.0824], [42.3476, -71.0886]],
  '02127': [[42.3309, -71.0565], [42.3324, -71.0324], [42.3446, -71.0269], [42.3478, -71.0470], [42.3388, -71.0601]],
  '02128': [[42.3650, -71.0456], [42.3666, -71.0174], [42.3784, -71.0119], [42.3826, -71.0328], [42.3728, -71.0471]],
  '02129': [[42.3710, -71.0662], [42.3718, -71.0487], [42.3822, -71.0472], [42.3840, -71.0603], [42.3776, -71.0691]],
  '02210': [[42.3436, -71.0512], [42.3444, -71.0284], [42.3560, -71.0278], [42.3571, -71.0428], [42.3503, -71.0532]],
};

export interface BuildDraft {
  id: string;
  name: string;
  type: 'delivery' | 'pickup' | 'mixed';
  jobs: number;
  state: 'in-progress' | 'awaiting-review' | 'queued-to-build';
  builtBy: 'dispatcher' | 'auto-build';
  updatedMinsAgo: number;
}

export const mockDrafts: BuildDraft[] = [
  { id: 'D-7701', name: 'Auckland CBD AM Med (draft)', type: 'delivery', jobs: 6, state: 'in-progress', builtBy: 'dispatcher', updatedMinsAgo: 4 },
  { id: 'D-7702', name: 'North Shore Diagnostics', type: 'delivery', jobs: 4, state: 'awaiting-review', builtBy: 'auto-build', updatedMinsAgo: 12 },
  { id: 'D-7703', name: 'Manukau Pharma Loop', type: 'delivery', jobs: 5, state: 'queued-to-build', builtBy: 'auto-build', updatedMinsAgo: 22 },
  { id: 'D-7704', name: 'PM Return Pickups (East)', type: 'pickup', jobs: 4, state: 'in-progress', builtBy: 'dispatcher', updatedMinsAgo: 1 },
];
