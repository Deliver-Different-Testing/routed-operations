// Shared type declarations for the React SPA. Mirrors the backend DTOs manually
// - no OpenAPI codegen (matches the Configurator pattern).

export interface AppUser {
  currentTenantId: number | null;
  fullName: string | null;
  email: string | null;
  timeZone: string | null;
  countryCode: string | null;
  isUsTenant: boolean;
  // Sourced from the Hub "Internal" claim on login. Gates internal-only
  // affordances like Bulk Import's Staff Import button.
  isInternal: boolean;
  hereMapsApiKey: string | null;
  googleMapsKey: string | null;
  // Route Viewer P0 additions (2026-08-07). All optional - Route Viewer
  // module consumes for NP-scope gating, CS event visibility, top-bar
  // client dropdown, and the initial pickDate filter. Other modules
  // (Route Builder etc.) ignore these fields.
  isNetworkPartner: boolean;
  npAgentId: number | null;
  clientTypeId: string | null;
  contactId: number | null;
  clientId: number | null;
  clientCount: number | null;
  clientString: string | null;
  // Recurring Routes port (2026-08-12). Powers the Recurring Jobs external
  // link on the Recurring Routes page + the "Open ↗" deep-link inside the
  // Linehaul edit modal's Used-by-Schedules list. Null hides both.
  despatchWebBaseUrl?: string | null;
}

declare global {
  interface Window {
    __APP_USER__?: AppUser;
    // HERE Maps JS API - still loaded by the Razor host for the Fix GPS modal
    // geocoding path. Cockpit map switched to Google Maps for parity with
    // legacy RunBuilder.
    H?: any;
    // Google Maps JS API loaded by the Razor host when GoogleMapsKey is set.
    // Typed as `any` because the SDK's own types aren't imported.
    google?: any;
  }
}

export interface BulkJob {
  bulkJobId: number;
  jobNumber: string | null;
  bookDate: string;
  bookTime: string;
  jobStatus: number;
  clientId: number;
  clientCode: string | null;
  amount: number | null;
  speed: number;
  speedName: string | null;
  fromCompany: string | null;
  fromAddress: string | null;
  fromSuburb: string | null;
  fromPostCode: number | null;
  toCompany: string | null;
  toAddress: string | null;
  toSuburb: string | null;
  toPostCode: number | null;
  size: number | null;
  qty: number | null;
  weight: number | null;
  courierId: number | null;
  courierName: string | null;
  clientRefa: string | null;
  clientRefb: string | null;
  ourRef: string | null;
  notes: string | null;
  pickUpLatitude: string | null;
  pickUpLongitude: string | null;
  deliveryLatitude: string | null;
  deliveryLongitude: string | null;
  prebookJob: boolean | null;
  onHold: boolean;
  void: boolean;
  done: boolean;
  bulkRunId: number | null;
  runName: string | null;
  runOrder: number | null;
  multiboxParentId: number | null;
  parentId: number | null;
  regionId: number | null;
  barcode: string | null;
  // Signature-not-required flag. Legacy SP aliased tblBulkJob.DeliverToPrivateBusiness
  // AS 'Ok_To_Leave'. JobDetail renders as "Sig not req" checkbox.
  okToLeave: boolean | null;
  // Contact / tracking / POD - editable via JobDetail pane.
  contact: string | null;
  deliverToContact: string | null;
  deliverToPhone: string | null;
  trackingEmail: string | null;
  trackingMobile: string | null;
  proofOfDeliveryEmail: string | null;
  proofOfDeliveryMobile: string | null;
  // Delivery Window fields.
  scheduleId: number | null;
  scheduleName: string | null;
  scheduleWindowStart: string | null;
  scheduleWindowEnd: string | null;
  jobCubicM3: number | null;
  // Per-client cap for Max Boxes build mode (from tucClient.MaxJobsPerRun).
  // null means "no client override" - callers should fall back to 20.
  maxJobsPerRun: number | null;
  // Pickup-cutoff hint from tblBulkRunSchedule (Plan §Phase 2 §6.5).
  // Non-null when the schedule has ApplyPickupCutoff = 1. Route Builder feeds
  // these into splitOrderedJobsByConstraints when the operator ticks the
  // "Respect pickup cutoff" option in the build config.
  applyPickupCutoff: boolean | null;
  pickupCutoffHours: number | null;
  // Postcode run-name lookup (legacy TblBulkPostCodeRunName). PrefixRunName is
  // used by Build Runs Max Boxes mode to group jobs; PostCodeMergeTo folds two
  // postcodes into the same run.
  prefixRunName: string | null;
  postCodeMergeTo: string | null;
  runSequence: number;
  // ID of the tblBulkJobRun link row. 0 when the job is not on a run.
  bulkJobRunId: number;
}

export interface VehicleSize {
  vehicleSizeId: number;
  vehicleName: string;
  cubicCapacity: number | null;
}

export type BuildParameter = 'maxBoxes' | 'deliveryWindow';
// Routing mode surfaced in the build config UI. Persisted onto tblBulkRun so
// the driver app / dispatch downstream can honour it.
//   'aToB' - default: depot -> furthest point (HERE default)
//   'aToA' - circuit: depot -> ... -> depot (HERE end=start)
//   'finishAtStop' - depot -> ... -> nominated stop (HERE end=<pinned>)
export type RoutingMode = 'aToB' | 'aToA' | 'finishAtStop';

/**
 * User-tunable build knobs, persisted in localStorage. Mirrors the legacy
 * buildConfig object from RunBuilder homeControl.js.
 */
export interface BuildConfig {
  buildParameter: BuildParameter;
  minutesPerStop: number;
  vehicleCapacityEnabled: boolean;
  vehicleSizeId: number | 'custom';
  vehicleCubicCap: number;
  // Routing-mode + Plan §Phase 2 §6 additions.
  routingMode: RoutingMode;
  finishAtBulkJobId: number | null;
  noReroute: boolean;
  respectPickupCutoff: boolean;
}

export interface RunJob {
  bulkJobId: number;
  builderIndex: number | null;
  jobNumber: string | null;
  // Per-run-per-job start / end markers (legacy runBuilder.tpl:50-54).
  isStart: boolean;
  isEnd: boolean;
  // Enriched fields the Run Builder pane displays.
  clientCode: string | null;
  deliveryDate: string | null;
  bookTime: string | null;
  toAddress: string | null;
  toSuburb: string | null;
  toPostCode: number | null;
  courierName: string | null;
  speedName: string | null;
  deliveryLatitude: string | null;
  amount: number | null;
}

export interface Run {
  id: number;
  name: string | null;
  mins: number | null;
  kms: number | null;
  courierId: number | null;
  courierName: string | null;
  status: number | null;
  revenue: number | null;
  payout: number | null;
  courierPercentage: number | null;
  googleRouteResponse: string | null;
  despatchDateTime: string | null;
  // Routing-mode fields (Plan §Phase 2 §6). Migration 20260716210000 adds them
  // to tblBulkRun; RunService projects them here.
  noReroute: boolean;
  routingMode: number;              // 0=A-B, 1=A-A, 2=FinishAtStop
  finishAtBulkJobId: number | null; // only meaningful when routingMode === 2
  // Marks the special "Void Jobs" run. Rendered locked with a ban icon.
  isVoidRun: boolean;
  // Fleet name for the assigned courier (from tucCourierFleet.UccfName).
  fleet: string | null;
  jobs: RunJob[];
}

export interface Courier {
  courierId: number;
  code: string;
  firstName: string;
  displayName: string;
  fleet: string | null;
}

export interface Fleet {
  fleet: string;
  couriers: Courier[];
}

export interface Region {
  id: number;
  label: string;
}

export interface Speed {
  id: number;
  label: string;
}

export interface JobFilters {
  date: string;         // yyyy-MM-dd
  clientIds: number[];
  regionIds: number[];
  ourRefs: string[];
  speeds: number[];
}
