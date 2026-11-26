import type { ClientDto, ClientSettingsDto } from '../../services/clientsService';
import type {
  BulkImportJobCreateDto,
  BulkTruckDefaults,
  BulkTruckPreviewResponse,
  ParsedFile,
  PickupJobToCreateResponse,
} from '../../services/bulkImportService';
import { addDaysYmd, tenantTodayYmd } from '../../lib/tenantDate';
import { parseBookDate } from './bookDateParse';

/**
 * State machine for the New Import wizard. Rendered by NewImportWizard.tsx.
 *
 * `step` is the currently-open modal. The wizard component switches on
 * this to render exactly one modal at a time (matching the AngularJS
 * single-step-visible behaviour).
 */
export type WizardStep =
  | 'newImport'
  | 'mapColumns'
  | 'fixZips'
  | 'fixAddresses'
  | 'selectRegions'
  | 'schedulePicker'
  | 'rateByDistance'
  | 'truckPreview'
  | 'kmRatedReview'
  | 'bookPickup'
  | 'summary'
  | 'done';

/**
 * Per-depot (NZ) / per-region (US) bucket surfaced by SelectRegionsModal.
 * Buckets iterate one-at-a-time through Step 6 -> import; each bucket
 * carries its own row-subset (jobIndexes) and per-bucket booking state
 * (bookDate / speed / schedule). Mirrors the shape from BulkImportHyper
 * homeControl.js sortByDepot output.
 */
export interface DepotBucket {
  depotId: number;
  depotName: string;
  jobIndexes: number[];
  // True when the depot has no schedules for this client (routed only), e.g.
  // an airline depot that only exists for air-freight rating. Rows land in
  // the bucket so the operator can see them, but it cannot be ticked or
  // imported.
  noService?: boolean;
  // Source row index -> postcode (NZ) or zip (US) to send instead of what
  // buildJobs produced. NZ: set for rows the geocoder's postcode placed in
  // this depot (accepted, or untouched with a sheet postcode that has no
  // depot; see effectiveNzPostCode), so the job is booked against the
  // postcode it was grouped by.
  // US (#332): set for rows whose own zip matched this depot while fixedZips
  // holds a different value for that zip, so the sheet zip is sent unchanged.
  postCodeOverrides?: Record<number, string>;
}

export interface PerDepotResult {
  depotId: number;
  imported: number;
  failed: number;
}

export type ImportType = 'routed' | 'onDemand';

export interface WizardOptions {
  overrideFromContact: string;
  overrideDimensions: string;
  stopType: string;                       // 'mapped' | 'pickup' | 'dropoff'
  routeStartsFromClientSite: boolean;
  originLocation: number | null;
  templateId: number | null;
  autogenerateJobNumber: boolean;
  importAsCompleted: boolean;
  saveAsTemplate: boolean;
  templateName: string;
  // NZ On-Demand only. Persisted from the SchedulePickerModal and spread
  // onto every job payload when jobType === 'ondemand' && !isUs, matching
  // BulkImportHyper homeControl.js:3359-3363.
  onHold: boolean;
  nationwideDoc: boolean;
  // NZ On-Demand only. The operator says the file holds truck jobs, for files
  // with no Speed column. truckDefaults apply to truck rows that leave the
  // matching column empty.
  truckJobs: boolean;
  truckDefaults: BulkTruckDefaults;
}

export interface WizardState {
  // The tenant's zone from the auth claim, kept so RESET and a client switch
  // default the Book Date to the same tenant tomorrow. Null = browser zone.
  tenantTimeZone: string | null;
  step: WizardStep;
  client: ClientDto | null;
  file: File | null;
  parsed: ParsedFile | null;
  importType: ImportType;
  // system-field -> customer-column mapping (system-field key is one of the
  // urgentFields entries in the AngularJS source).
  mapping: Record<string, string>;
  options: WizardOptions;
  fixedZips: Record<string, string>;                   // bad zip -> corrected
  // NZ: the tucSuburb id picked for a fixedZips key. Suburb names repeat
  // (two Newtons), so the select shows this id, and it survives a remount.
  fixedSuburbIds: Record<string, number>;
  fixedAddresses: Record<number, { lat: number; lng: number }>;
  // NZ geocoder postcode the operator ACCEPTED in FixAddressesModal, keyed
  // on rowIndex. Depot grouping uses it even over a sheet postcode that
  // matches a depot. Only DECIDE_SUGGESTION (accept) writes it (#332).
  fixedPostCodes: Record<number, string>;
  // NZ geocoder suggestions that differ from the sheet (#332): 'pc:<row>'
  // for a postcode, 'sub:<row>' for a suburb. A suburb suggestion is applied
  // only once accepted. A postcode suggestion left pending is used for depot
  // grouping only when the sheet postcode matches no depot (see
  // effectiveNzPostCode); Keep sheet stops that.
  geocodeSuggestions: Record<string, GeocodeSuggestion>;
  // Fixed FROM (pickup) coordinates keyed on rowIndex. On-demand batches
  // need accurate pickup coords for immediate dispatch; the FixAddresses
  // step lets the operator pin-correct any flagged row's origin the same
  // way as its destination. Legacy geocode pass at AddressService.cs:200
  // returns both from + to lat/lng.
  fixedFromAddresses: Record<number, { lat: number; lng: number }>;
  // selectedRegions now holds numeric depotIds as strings (per real depot
  // buckets from address service) alongside the legacy 'valid' / 'unmatched'
  // synthetic buckets for backward compat with existing paths.
  selectedRegions: Set<string>;
  rateByDistanceDate: string | null;
  // Real depot / region buckets fetched via addressService.getDepots (NZ)
  // or addressService.getLocationsZipCodes (US), populated in
  // SelectRegionsModal at mount. Each bucket carries the row indexes that
  // fall into it based on the parsed rows' toPostCode / toZipCode.
  depots: DepotBucket[];
  currentDepotIndex: number;
  perDepotResults: PerDepotResult[];
  // Depot ids whose rows have already been sent to /import. Legacy kept a
  // per-bucket `done` flag (ROUTED-WIZARD-SPEC.md:1273-1276); navigating
  // Back and Next again must skip these so a depot is never imported twice.
  completedDepotIds: Set<number>;
  // Cached client settings loaded once in MapColumnsModal. Downstream picker
  // steps read schedules / speeds / stockSizes from here to avoid re-fetching.
  clientSettings: ClientSettingsDto | null;
  // SchedulePickerModal state. bookDate defaults to tomorrow (yyyy-MM-dd),
  // bookTime empty (populated from schedule.startTime for routed, or
  // rounded-up now+15min for on-demand). speedId 0 means unpicked;
  // scheduleId null means unpicked or not applicable (on-demand skips it).
  bookDate: string;
  bookTime: string;
  speedId: number;
  scheduleId: number | null;
  // Km-rated review (Step 7). kmRatedRows is populated from response.jobs
  // when the first-pass import returns km-rated rows for operator review.
  // kmRatedSelected is a Set of row indexes into kmRatedRows the operator
  // has ticked (default: all ticked). kmRatedConfirmed flips to true when
  // the re-fire payload is being built; fireImport reads it into
  // request.isKmRatedJobs. failedImportJobs stashes rows the operator
  // deselected on the km-rated round for the "Unimported" list.
  kmRatedRows: BulkImportJobCreateDto[];
  kmRatedSelected: Set<number>;
  // Source row index (into parsed.rows) per kmRatedRows entry, or null when
  // the row could not be traced back. Drives the full-source-row export.
  kmRatedSourceRows: (number | null)[];
  kmRatedConfirmed: boolean;
  failedImportJobs: BulkImportJobCreateDto[];
  // Last /import rejection, kept on state so it stays on screen until
  // the operator changes something. The toast that used to be the only
  // surface auto-dismisses after 4s, which is not long enough to read
  // "These job number(s) already exist for this date: ..." or a mapping
  // complaint, let alone act on it.
  importError: string | null;
  // Truck prices for the current depot, fetched each time the operator leaves
  // the schedule picker, because the book date and service both move the price.
  truckPreview: BulkTruckPreviewResponse | null;
  truckPreviewError: string | null;
  // Pickup booking (Step 8). pickupJobPayload is the earliest-cutoff pickup
  // job aggregated across per-depot imports (matches
  // homeControl.js:3226-3229). BookPickupModal reads from this to hydrate
  // its form defaults.
  pickupJobPayload: PickupJobToCreateResponse | null;
}

// Tomorrow in the tenant's zone. Cutting the date from toISOString() gave the
// UTC date, which is today for an NZ operator until 13:00 NZDT (#881).
function defaultBookDate(tenantTimeZone: string | null): string {
  return addDaysYmd(tenantTodayYmd({ isUsTenant: false, timeZone: tenantTimeZone }), 1);
}

export interface GeocodeSuggestion {
  kind: 'postCode' | 'suburb';
  rowIndex: number;
  sheet: string;
  map: string;
  // fixedZips key the accepted suburb is written under (suburb only).
  zipKey?: string;
  decision: 'pending' | 'accept' | 'keep';
}

/**
 * NZ (#332): the postcode depot grouping tries instead of the sheet postcode,
 * or null to keep the sheet one. `sheetHasDepot` is whether the sheet postcode
 * matches a depot; `accepted` is fixedPostCodes[row]; `suggestion` is
 * geocodeSuggestions['pc:<row>'].
 * - Accept: the accepted postcode, even when the sheet postcode has a depot.
 * - Untouched (pending): the map postcode, only when the sheet postcode has no
 *   depot, as before round 2 (Steve 2026-11-26).
 * - Keep sheet: never.
 */
export function effectiveNzPostCode(
  sheetHasDepot: boolean,
  accepted: string | undefined,
  suggestion: GeocodeSuggestion | undefined
): string | null {
  if (accepted) return accepted;
  if (suggestion?.kind !== 'postCode') return null;
  if (suggestion.decision === 'pending' && !sheetHasDepot) return suggestion.map;
  return null;
}

function sameMapping(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/** `tenantTimeZone` is the auth claim (Windows or IANA name); null = browser zone. */
export function initialWizardState(tenantTimeZone: string | null = null): WizardState {
  return {
    tenantTimeZone,
    step: 'newImport',
    client: null,
    file: null,
    parsed: null,
    importType: 'routed',
    mapping: {},
    options: {
      overrideFromContact: '',
      overrideDimensions: '',
      stopType: 'mapped',
      routeStartsFromClientSite: false,
      originLocation: null,
      templateId: null,
      autogenerateJobNumber: false,
      importAsCompleted: false,
      saveAsTemplate: false,
      templateName: '',
      onHold: false,
      nationwideDoc: false,
      truckJobs: false,
      truckDefaults: {},
    },
    fixedZips: {},
    fixedSuburbIds: {},
    fixedAddresses: {},
    fixedPostCodes: {},
    geocodeSuggestions: {},
    fixedFromAddresses: {},
    selectedRegions: new Set(),
    rateByDistanceDate: null,
    depots: [],
    currentDepotIndex: 0,
    perDepotResults: [],
    completedDepotIds: new Set(),
    clientSettings: null,
    bookDate: defaultBookDate(tenantTimeZone),
    bookTime: '',
    speedId: 0,
    scheduleId: null,
    kmRatedRows: [],
    kmRatedSelected: new Set(),
    kmRatedSourceRows: [],
    kmRatedConfirmed: false,
    failedImportJobs: [],
    importError: null,
    truckPreview: null,
    truckPreviewError: null,
    pickupJobPayload: null,
  };
}

export type WizardAction =
  | { type: 'RESET' }
  | { type: 'GOTO'; step: WizardStep }
  | { type: 'SET_CLIENT'; client: ClientDto | null }
  | { type: 'SET_FILE'; file: File | null }
  | { type: 'SET_IMPORT_TYPE'; importType: ImportType }
  | { type: 'SET_PARSED'; parsed: ParsedFile }
  | { type: 'SET_MAPPING'; mapping: Record<string, string> }
  | { type: 'PATCH_MAPPING'; field: string; column: string }
  | { type: 'SET_OPTIONS'; options: Partial<WizardOptions> }
  | { type: 'SET_FIXED_ZIP'; badZip: string; corrected: string; suburbId?: number }
  | { type: 'SET_FIXED_ADDRESS'; rowIndex: number; coords: { lat: number; lng: number } }
  // Records a suggestion; an existing one keeps its decision (#332).
  | { type: 'ADD_GEOCODE_SUGGESTION'; key: string; suggestion: GeocodeSuggestion }
  | { type: 'DECIDE_SUGGESTION'; key: string; decision: 'accept' | 'keep' }
  | { type: 'SET_FIXED_FROM_ADDRESS'; rowIndex: number; coords: { lat: number; lng: number } }
  | { type: 'SET_SELECTED_REGIONS'; regions: Set<string> }
  | { type: 'TOGGLE_REGION'; region: string }
  | { type: 'SET_RBD_DATE'; date: string | null }
  | { type: 'SET_CLIENT_SETTINGS'; settings: ClientSettingsDto | null }
  | { type: 'SET_BOOK_DATE'; date: string }
  | { type: 'SET_BOOK_TIME'; time: string }
  | { type: 'SET_SPEED_ID'; speedId: number }
  | { type: 'SET_SCHEDULE_ID'; scheduleId: number | null }
  | { type: 'SET_ON_HOLD'; value: boolean }
  | { type: 'SET_NATIONWIDE_DOC'; value: boolean }
  | { type: 'SET_DEPOTS'; depots: DepotBucket[] }
  // Store freshly computed buckets and reconcile the tick selection against
  // them without discarding the operator's earlier unticks. See
  // seedDepotSelection.
  | { type: 'SEED_DEPOTS'; depots: DepotBucket[] }
  | { type: 'SET_CURRENT_DEPOT'; index: number }
  // Point the cursor at the first ticked depot that has not been imported.
  | { type: 'START_PENDING_DEPOT' }
  | { type: 'MARK_DEPOT_DONE'; depotId: number }
  | { type: 'ADD_PER_DEPOT_RESULT'; result: PerDepotResult }
  | { type: 'RESET_PER_DEPOT_RESULTS' }
  | { type: 'SET_KMRATED'; rows: BulkImportJobCreateDto[]; sourceRows?: (number | null)[] }
  | { type: 'TOGGLE_KMRATED_ROW'; index: number }
  | { type: 'SET_ALL_KMRATED_SELECTED'; selected: boolean }
  | { type: 'SET_KMRATED_CONFIRMED'; value: boolean }
  | { type: 'SET_FAILED_IMPORT_JOBS'; jobs: BulkImportJobCreateDto[] }
  | { type: 'SET_IMPORT_ERROR'; message: string | null }
  | { type: 'SET_TRUCK_PREVIEW'; preview: BulkTruckPreviewResponse | null }
  | { type: 'SET_TRUCK_PREVIEW_ERROR'; message: string | null }
  | { type: 'SET_PICKUP_JOB'; payload: PickupJobToCreateResponse | null }
  // Overwrites the current mapping wholesale with the template's mappings.
  // Only urgent fields present in the template appear in the new mapping;
  // fields the template does not mention stay empty (the operator can still
  // fill them individually in Step 2). Also stamps templateId so we don't
  // reoffer "Save as template" for a template the operator just picked.
  | { type: 'APPLY_TEMPLATE'; templateId: number | null; mapping: Record<string, string> };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'RESET':
      return initialWizardState(state.tenantTimeZone);
    case 'GOTO':
      return { ...state, step: action.step };
    case 'SET_CLIENT': {
      // When the operator switches to a DIFFERENT client, wipe every piece
      // of state that was derived from the previous client so nothing bleeds
      // across (Client A's clientSettings, mapping, parsed rows, template
      // selection, and fixed-address overrides all become meaningless for
      // Client B). First-time selection (previous client is null) leaves
      // the untouched fields alone. Same-id no-op just refreshes the ref.
      const prevId = state.client?.id ?? null;
      const nextId = action.client?.id ?? null;
      if (prevId != null && nextId !== prevId) {
        const fresh = initialWizardState(state.tenantTimeZone);
        return { ...fresh, client: action.client };
      }
      return { ...state, client: action.client };
    }
    case 'SET_FILE':
      return { ...state, file: action.file };
    case 'SET_IMPORT_TYPE':
      return { ...state, importType: action.importType };
    // #332: geocodeSuggestions and fixedPostCodes are keyed on row index and a
    // pending postcode suggestion now moves a row, so a new file or a changed
    // mapping drops them; Fix Addresses re-geocodes and adds them again.
    case 'SET_PARSED':
      return { ...state, parsed: action.parsed, geocodeSuggestions: {}, fixedPostCodes: {} };
    case 'SET_MAPPING':
      return sameMapping(state.mapping, action.mapping)
        ? { ...state, mapping: action.mapping }
        : { ...state, mapping: action.mapping, geocodeSuggestions: {}, fixedPostCodes: {} };
    case 'PATCH_MAPPING':
      return state.mapping[action.field] === action.column
        ? state
        : {
            ...state,
            mapping: { ...state.mapping, [action.field]: action.column },
            geocodeSuggestions: {},
            fixedPostCodes: {},
          };
    case 'SET_OPTIONS':
      return { ...state, options: { ...state.options, ...action.options } };
    case 'SET_FIXED_ZIP': {
      // A fix without an id drops any earlier pick so the two never disagree.
      const fixedSuburbIds = { ...state.fixedSuburbIds };
      if (action.suburbId !== undefined) fixedSuburbIds[action.badZip] = action.suburbId;
      else delete fixedSuburbIds[action.badZip];
      return {
        ...state,
        fixedZips: { ...state.fixedZips, [action.badZip]: action.corrected },
        fixedSuburbIds,
      };
    }
    case 'SET_FIXED_ADDRESS':
      return {
        ...state,
        fixedAddresses: { ...state.fixedAddresses, [action.rowIndex]: action.coords },
      };
    case 'ADD_GEOCODE_SUGGESTION': {
      const prev = state.geocodeSuggestions[action.key];
      if (prev && prev.sheet === action.suggestion.sheet && prev.map === action.suggestion.map) return state;
      // A replaced postcode suggestion takes its earlier Accept with it (#332).
      const fixedPostCodes = { ...state.fixedPostCodes };
      if (prev && action.suggestion.kind === 'postCode') delete fixedPostCodes[action.suggestion.rowIndex];
      return {
        ...state,
        fixedPostCodes,
        geocodeSuggestions: { ...state.geocodeSuggestions, [action.key]: action.suggestion },
      };
    }
    case 'DECIDE_SUGGESTION': {
      const sg = state.geocodeSuggestions[action.key];
      if (!sg) return state;
      const accept = action.decision === 'accept';
      const next = { ...state, geocodeSuggestions: { ...state.geocodeSuggestions, [action.key]: { ...sg, decision: action.decision } } };
      if (sg.kind === 'postCode') {
        const fixedPostCodes = { ...state.fixedPostCodes };
        if (accept) fixedPostCodes[sg.rowIndex] = sg.map;
        else delete fixedPostCodes[sg.rowIndex];
        return { ...next, fixedPostCodes };
      }
      if (!sg.zipKey) return next;
      const fixedZips = { ...state.fixedZips };
      const fixedSuburbIds = { ...state.fixedSuburbIds };
      // The suggestion replaces (or takes back) the fix, so a picked
      // tucSuburb id for this key no longer describes it.
      if (accept) {
        fixedZips[sg.zipKey] = sg.map;
        delete fixedSuburbIds[sg.zipKey];
      } else if (fixedZips[sg.zipKey] === sg.map) {
        delete fixedZips[sg.zipKey];
        delete fixedSuburbIds[sg.zipKey];
      }
      return { ...next, fixedZips, fixedSuburbIds };
    }
    case 'SET_FIXED_FROM_ADDRESS':
      return {
        ...state,
        fixedFromAddresses: {
          ...state.fixedFromAddresses,
          [action.rowIndex]: action.coords,
        },
      };
    case 'SET_SELECTED_REGIONS':
      return { ...state, selectedRegions: action.regions };
    case 'TOGGLE_REGION': {
      const next = new Set(state.selectedRegions);
      if (next.has(action.region)) next.delete(action.region);
      else next.add(action.region);
      return { ...state, selectedRegions: next };
    }
    case 'SET_RBD_DATE':
      return { ...state, rateByDistanceDate: action.date };
    case 'SET_CLIENT_SETTINGS':
      return { ...state, clientSettings: action.settings };
    case 'SET_BOOK_DATE':
      return { ...state, bookDate: action.date };
    case 'SET_BOOK_TIME':
      return { ...state, bookTime: action.time };
    case 'SET_SPEED_ID':
      return { ...state, speedId: action.speedId };
    case 'SET_SCHEDULE_ID':
      return { ...state, scheduleId: action.scheduleId };
    case 'SET_ON_HOLD':
      return {
        ...state,
        options: { ...state.options, onHold: action.value },
      };
    case 'SET_NATIONWIDE_DOC':
      return {
        ...state,
        options: { ...state.options, nationwideDoc: action.value },
      };
    case 'SET_DEPOTS':
      return { ...state, depots: action.depots };
    case 'SEED_DEPOTS':
      return {
        ...state,
        depots: action.depots,
        selectedRegions: seedDepotSelection(state, action.depots),
      };
    case 'SET_CURRENT_DEPOT':
      // Service / schedule / book time are per depot (legacy
      // resetDepotOptions at homeControl.js:488-531). Clearing them in the
      // same update as the cursor move means no render ever sees the new
      // depot paired with the previous depot's picks. bookDate carries
      // over on purpose, matching legacy.
      return {
        ...state,
        currentDepotIndex: action.index,
        speedId: 0,
        scheduleId: null,
        bookTime: '',
        truckPreview: null,
        truckPreviewError: null,
      };
    case 'START_PENDING_DEPOT': {
      const index = nextPendingDepotIndex(state, 0);
      return {
        ...state,
        currentDepotIndex: index < 0 ? 0 : index,
        speedId: 0,
        scheduleId: null,
        bookTime: '',
        truckPreview: null,
        truckPreviewError: null,
      };
    }
    case 'MARK_DEPOT_DONE': {
      if (state.completedDepotIds.has(action.depotId)) return state;
      const next = new Set(state.completedDepotIds);
      next.add(action.depotId);
      return { ...state, completedDepotIds: next };
    }
    case 'ADD_PER_DEPOT_RESULT':
      return { ...state, perDepotResults: [...state.perDepotResults, action.result] };
    case 'RESET_PER_DEPOT_RESULTS':
      return { ...state, perDepotResults: [] };
    case 'SET_KMRATED': {
      // Default: pre-tick every km-rated row (matches homeControl.js
      // checkUncheckAll behaviour at load time).
      const all = new Set<number>();
      for (let i = 0; i < action.rows.length; i++) all.add(i);
      return {
        ...state,
        kmRatedRows: action.rows,
        kmRatedSelected: all,
        kmRatedSourceRows: action.sourceRows ?? action.rows.map(() => null),
      };
    }
    case 'TOGGLE_KMRATED_ROW': {
      const next = new Set(state.kmRatedSelected);
      if (next.has(action.index)) next.delete(action.index);
      else next.add(action.index);
      return { ...state, kmRatedSelected: next };
    }
    case 'SET_ALL_KMRATED_SELECTED': {
      if (!action.selected) return { ...state, kmRatedSelected: new Set() };
      const all = new Set<number>();
      for (let i = 0; i < state.kmRatedRows.length; i++) all.add(i);
      return { ...state, kmRatedSelected: all };
    }
    case 'SET_KMRATED_CONFIRMED':
      return { ...state, kmRatedConfirmed: action.value };
    case 'SET_FAILED_IMPORT_JOBS':
      return { ...state, failedImportJobs: action.jobs };
    case 'SET_IMPORT_ERROR':
      return { ...state, importError: action.message };
    case 'SET_TRUCK_PREVIEW':
      return { ...state, truckPreview: action.preview };
    case 'SET_TRUCK_PREVIEW_ERROR':
      return { ...state, truckPreviewError: action.message };
    case 'SET_PICKUP_JOB':
      return { ...state, pickupJobPayload: action.payload };
    case 'APPLY_TEMPLATE':
      return {
        ...state,
        mapping: action.mapping,
        options: { ...state.options, templateId: action.templateId },
      };
    default:
      return state;
  }
}

function isSelectableBucket(b: DepotBucket): boolean {
  // Unmatched (0) and no-service buckets can never be ticked. Real depots
  // (> 0) and the US coverage-only bucket (-1) can.
  return b.depotId !== 0 && !b.noService && b.jobIndexes.length > 0;
}

/**
 * Reconcile the tick selection against a freshly computed bucket list.
 *
 * - A selectable depot that was not in the previous list is new, so it is
 *   pre-ticked (legacy pre-selects every real bucket).
 * - A depot that was already listed keeps whatever the operator chose, so
 *   Back / Next round trips do not re-tick depots they unticked.
 * - Completed depots stay ticked so the per-depot cursor still sees them.
 * - Ids no longer in the list (or now unselectable) are pruned.
 * - Non-numeric synthetic keys ('valid' / 'unmatched') pass through.
 */
export function seedDepotSelection(state: WizardState, depots: DepotBucket[]): Set<string> {
  const previouslyListed = new Set(
    state.depots.filter(isSelectableBucket).map((b) => String(b.depotId))
  );
  const next = new Set<string>();
  for (const key of state.selectedRegions) {
    if (!/^-?\d+$/.test(key)) next.add(key);
  }
  for (const b of depots) {
    if (!isSelectableBucket(b)) continue;
    const key = String(b.depotId);
    if (
      !previouslyListed.has(key)
      || state.selectedRegions.has(key)
      || state.completedDepotIds.has(b.depotId)
    ) {
      next.add(key);
    }
  }
  return next;
}

/**
 * Buckets that take part in the per-depot import loop: ticked, selectable
 * buckets in display order. currentDepotIndex indexes into this list.
 * Completed depots stay in the list (so "2 of 3" labels stay stable) and
 * are skipped via nextPendingDepotIndex.
 */
export function includedDepotBuckets(state: WizardState): DepotBucket[] {
  return state.depots.filter(
    (d) => isSelectableBucket(d) && state.selectedRegions.has(String(d.depotId))
  );
}

/**
 * Index (into includedDepotBuckets) of the first depot at or after `from`
 * that has not been imported yet, or -1 when none remain.
 */
export function nextPendingDepotIndex(state: WizardState, from: number): number {
  const included = includedDepotBuckets(state);
  for (let i = Math.max(0, from); i < included.length; i++) {
    if (!state.completedDepotIds.has(included[i].depotId)) return i;
  }
  return -1;
}

// -----------------------------------------------------------------------------
// urgentFields - trimmed port of the AngularJS urgentFields config in
// homeControl.js. The wizard uses this to render Step 2 (Map Columns) and
// to auto-map incoming customer columns by alias.
//
// Field visibility is tenant-aware. `include` says whether the row shows at
// all; `required` says whether it must be mapped before Next enables. The
// aliases list drives auto-map (case-insensitive substring or exact match on
// the customer column header text).
// -----------------------------------------------------------------------------

export interface UrgentField {
  key: string;
  label: string;
  aliases?: string[];
  required?: boolean;
  showFor: 'both' | 'us' | 'nz';
  jobType?: ImportType | 'both';
  // Limits which headers the auto-match may claim. A template or a manual pick is not limited.
  acceptsHeader?: (header: string) => boolean;
}

/**
 * Subset of client settings that alters urgent-field labels + required flags.
 * Passed through to urgentFieldsFor by MapColumnsModal once client settings
 * are fetched. Mirrors homeControl.js's `$scope.import.client.referenceX*`
 * reads at lines 1575-1605.
 */
export interface UrgentFieldsClientOverrides {
  referenceAMandatory: boolean;
  referenceAMessage: string | null;
  referenceBMandatory: boolean;
  referenceBMessage: string | null;
}

export interface RequiredFieldProblems {
  unmapped: string[];
  // records are the 1-based rows of every blank cell in that field's column.
  blank: { label: string; records: number[] }[];
}

// Records named in one wizard message before the rest are counted (#316, #319).
export const RECORDS_LISTED = 10;

function recordList(records: string[]): string {
  const more = records.length - RECORDS_LISTED;
  return records.slice(0, RECORDS_LISTED).join(', ') + (more > 0 ? ` +${more} more` : '');
}

/**
 * A required field is a problem when no column is mapped, or when the mapped
 * column is blank in any row. The second case catches a column that exists in
 * the sheet with no value in it, which the server would otherwise refuse.
 */
export function requiredFieldProblems(
  fields: Pick<UrgentField, 'key' | 'label' | 'required'>[],
  mapping: Record<string, string>,
  rows: Record<string, string>[]
): RequiredFieldProblems {
  const problems: RequiredFieldProblems = { unmapped: [], blank: [] };
  for (const field of fields) {
    if (!field.required) continue;
    const column = mapping[field.key];
    if (!column) {
      problems.unmapped.push(field.label);
      continue;
    }
    const records: number[] = [];
    rows.forEach((row, i) => {
      if (row[column] == null || String(row[column]).trim() === '') records.push(i + 1);
    });
    if (records.length > 0) problems.blank.push({ label: field.label, records });
  }
  return problems;
}

export function requiredFieldLines(problems: RequiredFieldProblems): string[] {
  const lines = problems.blank.map((b) =>
    b.records.length === 1
      ? `${b.label} is required: record ${b.records[0]} is blank`
      : `${b.label} is required: records ${recordList(b.records.map(String))} are blank`
  );
  if (problems.unmapped.length > 0) {
    lines.unshift(`Please map required column(s): ${problems.unmapped.join(', ')}.`);
  }
  return lines;
}

/**
 * #319. True when a Quantity cell holds something other than a whole number
 * from 1 to 32767. A blank cell is fine: the job books 1. Same rule as the
 * server's BulkQuantity, which refuses the rest with a 400 or a failed row.
 */
export function quantityCellProblem(cell: string | null | undefined): boolean {
  const text = (cell ?? '').trim();
  if (text === '') return false;
  if (!/^[+-]?\d+$/.test(text)) return true;
  const n = Number(text);
  return n < 1 || n > 32767;
}

/** The records whose Quantity cell would be refused, or null when there are none. */
export function quantityProblemLine(
  mapping: Record<string, string>,
  rows: Record<string, string>[]
): string | null {
  const column = mapping.quantity;
  if (!column) return null;
  const bad: string[] = [];
  rows.forEach((row, i) => {
    if (quantityCellProblem(row[column])) bad.push(`record ${i + 1} ('${String(row[column]).trim()}')`);
  });
  if (bad.length === 0) return null;
  return `Quantity must be a whole number from 1 to 32767: ${recordList(bad)}`;
}

// Keys added by urgentFieldsFor when a truck speed is in play.
export const TRUCK_FIELD_KEYS = [
  'speed', 'palletType', 'totalWeight', 'tailLiftPickup', 'tailLiftDropoff',
  'residential', 'dangerousGoods', 'dgClass', 'dgDocument', 'truckStart', 'truckHours',
];

// Weight is per item or per pallet, so it must not read a job total as its own.
const TOTAL_HEADER = /total|gross/i;
const WEIGHT_HEADER = /weight|wgt|kg|lb|pound/i;

// Needs both words: a bare "Total" column is usually money, and a plain "Weight"
// column is per item. Either would otherwise match by substring.
function totalWeightField(): UrgentField {
  return {
    key: 'totalWeight',
    label: 'Total Weight',
    aliases: ['TotalWeight', 'Total Kg', 'Total Kgs', 'Total Lbs', 'Total Pounds', 'Total Wgt',
      'Gross Weight', 'Gross Kg', 'Gross Kgs', 'Gross Lbs', 'Gross Pounds', 'Gross Wgt'],
    showFor: 'both',
    acceptsHeader: (h) => TOTAL_HEADER.test(h) && WEIGHT_HEADER.test(h),
  };
}

function speedField(): UrgentField {
  return { key: 'speed', label: 'Speed', aliases: ['Service', 'Service Level', 'Speed Code'], showFor: 'nz' };
}

function truckFields(): UrgentField[] {
  return [
    speedField(),
    { key: 'palletType', label: 'Pallet Type', aliases: ['PalletType', 'Pallet Size'], showFor: 'nz' },
    totalWeightField(),
    { key: 'tailLiftPickup', label: 'Tail Lift PU', aliases: ['TailLift PU', 'Tail Lift Pickup', 'Pickup Tail Lift'], showFor: 'nz' },
    { key: 'tailLiftDropoff', label: 'Tail Lift DO', aliases: ['TailLift DO', 'Tail Lift Delivery', 'Delivery Tail Lift'], showFor: 'nz' },
    { key: 'residential', label: 'Residential', aliases: ['Private Address', 'Private Residence'], showFor: 'nz' },
    { key: 'dangerousGoods', label: 'Dangerous Goods', aliases: ['DangerousGoods', 'DG'], showFor: 'nz' },
    { key: 'dgClass', label: 'DG Class', aliases: ['DGClass'], showFor: 'nz' },
    { key: 'dgDocument', label: 'DG Document', aliases: ['DGDocument', 'DG Documentation'], showFor: 'nz' },
    { key: 'truckStart', label: 'Truck Start', aliases: ['TruckStart', 'Start Time'], showFor: 'nz' },
    { key: 'truckHours', label: 'Truck Hours', aliases: ['TruckHours'], showFor: 'nz' },
  ];
}

export function urgentFieldsFor(
  isUsTenant: boolean,
  jobType: ImportType,
  autogenerateJobNumber: boolean,
  routeFromClientSite: boolean = false,
  clientOverrides?: UrgentFieldsClientOverrides,
  stockSizeOverridden: boolean = false,
  truckInPlay: boolean = false
): UrgentField[] {
  // Legacy visibility gates (homeControl.js:1141-1156):
  //   fromFieldsActiveAnyTenant = on-demand OR (US routed && routeFromClientSite)
  //   fromFieldsActiveUs        = isUs && (on-demand OR (routed && routeFromClientSite))
  //   fromSuburb/fromPostCode   = NZ on-demand ONLY
  // fromContact renders for all modes; hidden separately in MapColumnsModal
  // when Override From Contact is set (legacy include() = !import.fromContact).
  const fromActiveAny = jobType === 'onDemand'
    || (jobType === 'routed' && routeFromClientSite && isUsTenant);
  const fromActiveUs = isUsTenant
    && (jobType === 'onDemand' || (jobType === 'routed' && routeFromClientSite));
  const nzOnDemand = !isUsTenant && jobType === 'onDemand';

  const base: UrgentField[] = [];
  if (!autogenerateJobNumber) {
    base.push({
      key: 'jobNumber',
      label: 'Job Number',
      aliases: ['JobNumber', 'Job #', 'Job ID', 'JobID', 'Reference', 'Ref', 'Order Number', 'Order #', 'OrderNumber'],
      required: true,
      showFor: 'both',
    });
  }
  if (jobType === 'onDemand') {
    base.push({ key: 'bookDate', label: 'Book Date', aliases: ['Book Date', 'Date', 'Ready Date', 'Delivery Date'], showFor: 'both' });
    base.push({ key: 'bookTime', label: 'Book Time', aliases: ['Book Time', 'Time', 'Ready Time'], showFor: 'both' });
  }
  // #881: every NZ on-demand row can name its own Speed, P2P or truck. With a
  // truck speed in play it comes in with the truck fields below instead.
  if (nzOnDemand && !truckInPlay) base.push(speedField());

  // fromContact always shown (MapColumnsModal hides when Override From Contact set).
  //
  // Required, because the server requires it: BulkImportRequest validation
  // rejects the whole batch with "From Contact is required (map a column or
  // set the Override From Contact batch option)." on EVERY row. Leaving it
  // optional here let the operator map everything else, walk four more
  // steps, and only find out at the import. Setting the Override hides this
  // field from visibleFields, so ticking that satisfies the check the same
  // way Autogenerate Job Number satisfies jobNumber.
  base.push({
    key: 'fromContact',
    label: 'From Contact',
    aliases: ['Sender', 'Shipper', 'Origin Contact', 'Pickup Contact'],
    required: true,
    showFor: 'both',
  });

  // fromCompany + fromAddress - legacy homeControl.js:1298-1317.
  if (fromActiveAny) {
    base.push({
      key: 'fromCompany',
      label: 'From Company',
      aliases: ['Sender Company', 'Shipper Company', 'Origin Company', 'Pickup Company'],
      showFor: 'both',
    });
    base.push({
      key: 'fromAddress',
      label: 'From Address',
      aliases: isUsTenant
        ? ['Pickup Address', 'Pickup Street', 'Origin Address', 'Origin Street', 'Sender Address', 'From Street']
        : ['Pickup Address', 'Origin Address', 'Sender Address'],
      required: true,
      showFor: 'both',
    });
  }

  // fromCity / fromState / fromZipCode - US only, legacy 1318-1351.
  if (fromActiveUs) {
    base.push({
      key: 'fromCity',
      label: 'From City',
      aliases: ['Pickup City', 'Origin City', 'From City', 'Sender City'],
      required: true,
      showFor: 'us',
    });
    base.push({ key: 'fromState', label: 'From State', showFor: 'us' });
    base.push({
      key: 'fromZipCode',
      label: 'From Zip Code',
      aliases: ['Pickup ZIP', 'Pickup Zip', 'Origin ZIP', 'Origin Zip', 'From ZIP', 'Sender ZIP', 'Pickup Postal'],
      showFor: 'us',
    });
  }

  // fromSuburb / fromPostCode - NZ on-demand only, legacy 1327-1358.
  // NZ routed does NOT expose these because the server backfills them from
  // the client's saved site details (UcclSuburb / UcclPostCode) at job
  // construction time.
  if (nzOnDemand) {
    base.push({
      key: 'fromSuburb',
      label: 'From Suburb',
      aliases: ['Pickup Suburb', 'Origin Suburb', 'From Suburb', 'Sender Suburb'],
      required: true,
      showFor: 'nz',
    });
    base.push({
      key: 'fromPostCode',
      label: 'From Post Code',
      aliases: ['Pickup Post Code', 'Pickup Postcode', 'Origin Post Code', 'From Post Code', 'Sender Post Code'],
      showFor: 'nz',
    });
  }

  base.push({
    key: 'toCompany',
    label: isUsTenant ? 'Company' : 'To Company',
    aliases: isUsTenant
      ? ['Business', 'Business Name', 'Customer', 'Account', 'Recipient Company', 'To Business']
      : ['Recipient Company', 'To Business'],
    showFor: 'both',
  });
  base.push({
    key: 'toUnit',
    label: isUsTenant ? 'Unit/Suite' : 'To Unit/Suite',
    aliases: ['Suite', 'Apt', 'Apartment', 'Unit', 'Unit Number', 'Suite Number'],
    showFor: 'both',
  });
  base.push({
    key: 'toAddress',
    label: isUsTenant ? 'Address' : 'To Address',
    aliases: isUsTenant
      ? ['Street', 'Street Address', 'Address Line 1', 'Address1', 'Addr', 'Delivery Address', 'Destination Address', 'Drop Address', 'Recipient Address']
      : ['Delivery Address', 'Destination Address', 'Drop Address'],
    required: true,
    showFor: 'both',
  });

  if (isUsTenant) {
    base.push({ key: 'toCity', label: 'City', aliases: ['Town', 'Locality', 'Delivery City', 'Destination City'], required: true, showFor: 'us' });
    base.push({ key: 'toState', label: 'State', aliases: ['Province', 'Region', 'Delivery State', 'Destination State', 'ST'], required: true, showFor: 'us' });
    base.push({ key: 'toZipCode', label: 'Zip Code', aliases: ['ZIP', 'Zip', 'ZipCode', 'Postal Code', 'PostalCode', 'Postcode', 'Postal', 'Delivery ZIP', 'Destination ZIP'], required: true, showFor: 'us' });
  } else {
    base.push({ key: 'toSuburb', label: 'To Suburb', required: true, showFor: 'nz' });
    base.push({ key: 'toPostCode', label: 'To Post Code', showFor: 'nz' });
  }

  base.push({
    key: 'toContact',
    label: isUsTenant ? 'Contact' : 'To Contact',
    aliases: isUsTenant
      ? ['Recipient', 'Receiver', 'Attention', 'Handling', 'To Name', 'Delivery Contact', 'Destination Contact', 'Customer Name']
      : ['Recipient', 'Receiver', 'Delivery Contact', 'Destination Contact'],
    required: true,
    showFor: 'both',
  });
  base.push({
    key: 'toContactPhone',
    label: isUsTenant ? 'Contact Phone' : 'To Contact Phone',
    aliases: isUsTenant
      ? ['Phone', 'Phone Number', 'Telephone', 'Tel', 'Mobile', 'Cell', 'Contact #', 'Recipient Phone', 'Delivery Phone']
      : ['Phone', 'Delivery Phone', 'Recipient Phone'],
    required: true,
    showFor: 'both',
  });

  if (isUsTenant) {
    base.push({
      key: 'stopType',
      label: 'Stop Type',
      aliases: ['StopType', 'Type', 'Stop', 'Direction', 'Pickup/Dropoff', 'PickupOrDropoff'],
      showFor: 'us',
    });
  }
  base.push({
    key: 'quantity',
    label: 'Quantity',
    // "Items" is the legacy Despatch column name; homeControl.js quantity
    // aliases include it explicitly. Preserving that so a spreadsheet with
    // an Items column auto-maps to Quantity without operator intervention.
    aliases: ['Qty', 'Items', 'NumberOfItems', 'ItemCount', 'Pieces', 'Pcs', 'Count', 'Boxes', 'Cartons',
      ...(truckInPlay ? ['Pallets', 'Pallet Count', 'Pallet Qty'] : [])],
    showFor: 'both',
  });

  // Optional dimension columns. Legacy homeControl.js:1539-1572 gates all
  // four with `include: () => !$scope.import.stockSize` - if the operator
  // picks a stock size from the Override Dimensions dropdown, these rows
  // are hidden entirely because the picked size supplies length/width/
  // height/weight per row. When no stock size is set, they render as
  // optional map columns (operator CSV can supply per-row values).
  //
  // Aliases intentionally omit short 1-3 char forms (L, Lng, W, H, Wt).
  // Legacy has no aliases for these fields; our earlier `Lng` false-
  // positive-matched `fromLng` (from-longitude) because substring guards
  // dont apply to neutral fields. Full-word aliases only.
  if (!stockSizeOverridden) {
    base.push({
      key: 'length',
      label: 'Length',
      aliases: ['Length', 'PackageLength'],
      showFor: 'both',
    });
    base.push({
      key: 'width',
      label: 'Width',
      aliases: ['Width', 'PackageWidth'],
      showFor: 'both',
    });
    base.push({
      key: 'height',
      label: 'Height',
      aliases: ['Height', 'PackageHeight'],
      showFor: 'both',
    });
    base.push({
      key: 'weight',
      label: truckInPlay ? 'Weight (per pallet)' : 'Weight',
      aliases: ['Weight', 'Wgt', 'Lbs', 'Pounds', 'Kg', 'Kgs', 'PackageWeight'],
      showFor: 'both',
      // Routed imports keep their matching: they have no Total Weight to send it to.
      ...(jobType === 'onDemand' ? { acceptsHeader: (h: string) => !TOTAL_HEADER.test(h) } : {}),
    });
    if (jobType === 'onDemand' && !truckInPlay) base.push(totalWeightField());
  }

  // Optional reference / notes / tracking columns. Legacy homeControl.js
  // renders all as optional map rows unless the client has referenceA/B
  // mandatory flags set (in which case Ref A / Ref B become required).
  // The label pulls in the tenant-configured referenceAMessage /
  // referenceBMessage when present (see MapColumnsModal for the settings
  // hookup). Backend BulkImportJobFactory already reads every one of these
  // off BulkImportJobCreateDto, so we only need to expose the mapping UI.
  // Ref A / Ref B labels + required flags driven by client config
  // (referenceAMandatory / referenceAMessage). Legacy homeControl.js:1575-1605
  // reads the same client fields on every render.
  const refAMsg = clientOverrides?.referenceAMessage;
  const refBMsg = clientOverrides?.referenceBMessage;
  base.push({
    key: 'clientRefA',
    label: refAMsg ? `Ref A (${refAMsg})` : 'Ref A',
    aliases: ['RefA', 'Reference A', 'Reference 1', 'Customer Ref'],
    required: !!clientOverrides?.referenceAMandatory,
    showFor: 'both',
  });
  base.push({
    key: 'clientRefB',
    label: refBMsg ? `Ref B (${refBMsg})` : 'Ref B',
    aliases: ['RefB', 'Reference B', 'Reference 2'],
    required: !!clientOverrides?.referenceBMandatory,
    showFor: 'both',
  });
  base.push({
    key: 'ourRef',
    label: 'Our Ref',
    aliases: ['OurRef', 'Internal Ref', 'PO', 'PO Number'],
    showFor: 'both',
  });
  base.push({
    key: 'notes',
    label: 'Notes',
    aliases: ['Note', 'Comments', 'Comment', 'Description', 'Instructions', 'Special Instructions'],
    showFor: 'both',
  });
  base.push({
    key: 'trackingEmail',
    label: 'Tracking Email',
    aliases: ['Email', 'Notification Email', 'Recipient Email', 'Customer Email'],
    showFor: 'both',
  });
  base.push({
    key: 'trackingMobile',
    label: 'Tracking Mobile',
    aliases: ['SMS', 'Mobile', 'Notification Mobile', 'Notification SMS', 'Customer Mobile'],
    showFor: 'both',
  });

  if (truckInPlay) base.push(...truckFields());

  return base;
}

// -----------------------------------------------------------------------------
// Truck jobs (card bulk-insert-truck-and-ai, Part A). NZ on-demand only. A file
// with no truck speed sends exactly what it sent before.
// -----------------------------------------------------------------------------

export function truckFieldsEligible(state: WizardState, isUs: boolean): boolean {
  return !isUs
    && state.importType === 'onDemand'
    && !!state.clientSettings?.speeds?.some((s) => s.isTruck);
}

function isTruckSpeedValue(state: WizardState, value: string): boolean {
  return isClientSpeedValue(state, value, true);
}

/** Does the cell name one of the client's speeds (by id, code, system name or name)? */
function isClientSpeedValue(state: WizardState, value: string, truckOnly = false): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return !!state.clientSettings?.speeds?.some(
    (s) => (!truckOnly || s.isTruck) && [String(s.id), s.code, s.systemName, s.name]
      .some((candidate) => candidate?.trim().toLowerCase() === v)
  );
}

/** Does any row of this column name a truck speed? */
export function columnHasTruckSpeed(state: WizardState, column: string | undefined): boolean {
  if (!column) return false;
  return !!state.parsed?.rows.some((r) => isTruckSpeedValue(state, String(r[column] ?? '')));
}

export interface FromFileSummary {
  bookDate: { mapped: boolean; dates: number; anyBlank: boolean };
  bookTime: { mapped: boolean; anyBlank: boolean };
  speed: { mapped: boolean; names: string[]; anyBlank: boolean };
}

/**
 * UC #881. What an on-demand file brings per row for the defaults step:
 * Book Date (distinct dates), Book Time and Speed (names in file order), and
 * whether any row leaves one blank, which is when the defaults-step value is
 * used and so required. An unmapped column counts as every row blank. Speed
 * is NZ only. `rowIndexes` limits it to the current depot's rows.
 * A Speed the client does not have counts as blank too: on a point-to-point
 * file the server books that row on the batch speed (Kevin, option B), so the
 * batch speed is required. With no speed list loaded nothing is checked.
 */
export function fromFileSummary(state: WizardState, isUs: boolean, rowIndexes?: number[]): FromFileSummary {
  const all = state.parsed?.rows ?? [];
  const rows = rowIndexes ? rowIndexes.map((i) => all[i]).filter(Boolean) : all;
  const onDemand = state.importType === 'onDemand';
  const column = (key: string, allowed = true) => (onDemand && allowed ? state.mapping[key] || null : null);
  const cells = (col: string | null) => rows.map((r) => (col ? String(r[col] ?? '').trim() : ''));

  const dateCol = column('bookDate');
  const dates = cells(dateCol);
  const timeCol = column('bookTime');
  const times = cells(timeCol);
  const speedCol = column('speed', !isUs);
  const speedCells = cells(speedCol);
  const checkSpeeds = !!state.clientSettings?.speeds?.length;
  const usableSpeed = (v: string) => !!v && (!checkSpeeds || isClientSpeedValue(state, v));

  return {
    bookDate: {
      mapped: !!dateCol,
      dates: new Set(dates.filter(Boolean).map((d) => parseBookDate(d, isUs) ?? d)).size,
      anyBlank: dates.some((d) => !d),
    },
    bookTime: { mapped: !!timeCol, anyBlank: times.some((t) => !t) },
    speed: {
      mapped: !!speedCol,
      names: Array.from(new Set(speedCells.filter(Boolean))),
      anyBlank: speedCells.some((v) => !usableSpeed(v)),
    },
  };
}

/** The operator said so, the mapped Speed column names one, or the batch speed is one. */
export function truckInPlay(state: WizardState, isUs: boolean): boolean {
  if (!truckFieldsEligible(state, isUs)) return false;
  return state.options.truckJobs
    || columnHasTruckSpeed(state, state.mapping.speed)
    || !!state.clientSettings?.speeds?.some((s) => s.isTruck && s.id === state.speedId);
}

/**
 * #881. Clearing a template rebuilds the mapping from the aliases. Speed is
 * matched first, and when its column names a truck speed the truck fields are
 * matched too, as they would be on open. Before this the rebuild used the
 * fields of the moment, so a Speed held only by the template was dropped and
 * nothing matched it again.
 */
export function remapAfterTemplateClear(
  state: WizardState,
  isUs: boolean,
  fieldsFor: (truckInPlay: boolean) => UrgentField[]
): Record<string, string> {
  const headers = state.parsed?.headers ?? [];
  const auto: Record<string, string> = {};
  for (const f of fieldsFor(false)) {
    const match = autoMatchColumn(f, headers);
    if (match) auto[f.key] = match;
  }
  if (!truckFieldsEligible(state, isUs)) return auto;
  if (!auto.speed) {
    const match = autoMatchColumn(speedField(), headers);
    if (match && columnHasTruckSpeed(state, match)) auto.speed = match;
  }
  return truckInPlay({ ...state, mapping: auto }, isUs) ? autoMapTruckFields(fieldsFor(true), headers, auto) : auto;
}

/**
 * The truck fields did not exist when the auto-map ran on open, so match them
 * once a truck speed comes into play. A saved template can still hold Weight on a
 * lone "Total Weight" column, and it has to let go of it here, or a row total
 * would be read as a per-pallet figure.
 */
export function autoMapTruckFields(
  fields: UrgentField[],
  headers: string[],
  mapping: Record<string, string>
): Record<string, string> {
  const next = { ...mapping };
  for (const f of fields) {
    if ((!TRUCK_FIELD_KEYS.includes(f.key) && f.key !== 'quantity') || next[f.key]) continue;
    const match = autoMatchColumn(f, headers);
    if (!match) continue;
    next[f.key] = match;
  }
  if (next.totalWeight && next.weight === next.totalWeight) delete next.weight;
  return next;
}

/** Y / Yes / True / 1 and N / No / False / 0. Anything else counts as not given. */
export function parseYesNo(value: string | null): boolean | null {
  const v = value?.trim().toLowerCase();
  if (v === 'y' || v === 'yes' || v === 'true' || v === '1') return true;
  if (v === 'n' || v === 'no' || v === 'false' || v === '0') return false;
  return null;
}

/**
 * Stamps the truck columns onto a job. Only keys with a value are added, and
 * the caller only runs this when a truck speed is in play, so a P2P payload is
 * unchanged. A Total Weight on a row with no Weight of its own clears the stock
 * size's weight: the server uses Weight when present, and the row's figure
 * should win over a batch default.
 */
export function applyTruckFields(
  job: BulkImportJobCreateDto,
  get: (key: string) => string | null,
  mappedWeight: number | null
): void {
  const num = (key: string) => {
    const raw = get(key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const speed = get('speed');
  if (speed) job.speed = speed;
  const palletType = get('palletType');
  if (palletType) job.palletType = palletType;
  const truckStart = get('truckStart');
  if (truckStart) job.truckStart = truckStart;
  const totalWeight = num('totalWeight');
  if (totalWeight != null) {
    job.totalWeight = totalWeight;
    if (mappedWeight == null) job.weight = 0;
  }
  const dgClass = num('dgClass');
  if (dgClass != null) job.dgClass = Math.trunc(dgClass);
  const truckHours = num('truckHours');
  if (truckHours != null) job.truckHours = truckHours;
  const flags = {
    tailLiftPickup: parseYesNo(get('tailLiftPickup')),
    tailLiftDropoff: parseYesNo(get('tailLiftDropoff')),
    residential: parseYesNo(get('residential')),
    dangerousGoods: parseYesNo(get('dangerousGoods')),
    dgDocument: parseYesNo(get('dgDocument')),
  };
  for (const [key, value] of Object.entries(flags)) {
    if (value != null) (job as Record<string, unknown>)[key] = value;
  }
}

/**
 * Separates what an /import response handed back: rows the server refused from
 * the truck path go to the summary, the rest keep their existing km-rated route.
 */
export function splitReturnedJobs(returned: BulkImportJobCreateDto[]): {
  truckRejected: BulkImportJobCreateDto[];
  others: BulkImportJobCreateDto[];
} {
  return {
    truckRejected: returned.filter((j) => j.truckRejected),
    others: returned.filter((j) => !j.truckRejected),
  };
}

/** The counts and price total on the truck price step. */
export function truckPreviewTotals(preview: BulkTruckPreviewResponse | null): {
  wouldImport: number;
  wouldReject: number;
  totalPrice: number;
  importCount: number;
} {
  const rows = preview?.rows ?? [];
  const priced = rows.filter((r) => r.wouldImport);
  return {
    wouldImport: priced.length,
    wouldReject: rows.length - priced.length,
    totalPrice: priced.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    importCount: priced.length + (preview?.otherRowCount ?? 0),
  };
}

/**
 * Case-insensitive header -> urgent-field matcher. Returns the customer column
 * name that best fits an urgent field, or '' if none matched.
 *
 * Priority order (first hit wins). At every step we score all (field-alias,
 * header) candidates and pick the LONGEST-alias winner, not the first-listed;
 * this stops a shorter alias like `contact` on the `toContact` field from
 * stealing a header like `ContactPhone` that a longer alias `contactphone` on
 * `toContactPhone` should own (P1 hotfix).
 *
 *   1. Exact match against the field's normalized key (e.g. `fromaddress`),
 *      OR the key with a leading `to`/`from` stripped (so `toContact` key
 *      matches header `Contact`).
 *   2. Exact match against the field's label or any alias, with the same
 *      prefix-strip so alias `To Contact Phone` matches header `ContactPhone`.
 *   3. StartsWith prefix match on label / alias (only when both sides share a
 *      From/To prefix orientation, so `FromAddress` cannot map to `toAddress`).
 *      Longest matching alias wins.
 *   4. Substring match on label / alias, guarded by the same prefix rule AND
 *      by a minimum alias length of 3 so single-letter aliases like `H` / `W`
 *      cannot silently swallow unrelated headers like `Contact`. Longest
 *      matching alias wins.
 *
 * The From/To guard is symmetric: a field key that starts with `from` (or a
 * header that starts with `from`) will not match a header (or field) that
 * starts with `to`, and vice versa. Headers with no prefix pair freely with
 * either side of the field list.
 */
export function autoMatchColumn(field: UrgentField, allColumns: string[]): string {
  const customerColumns = field.acceptsHeader ? allColumns.filter(field.acceptsHeader) : allColumns;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, '');
  const prefixOf = (s: string): 'from' | 'to' | null => {
    const n = norm(s);
    if (n.startsWith('from') || n.startsWith('pickup') || n.startsWith('origin') || n.startsWith('sender') || n.startsWith('shipper')) return 'from';
    if (n.startsWith('to') || n.startsWith('delivery') || n.startsWith('destination') || n.startsWith('drop') || n.startsWith('recipient') || n.startsWith('receiver')) return 'to';
    return null;
  };
  // Strip a leading `to` or `from` (only those two - the other prefixes like
  // `delivery` / `pickup` stay attached because their strip would collide with
  // real words). This lets an alias `To Contact Phone` normalize to
  // `contactphone` and match a raw header of `ContactPhone`.
  const stripFromTo = (n: string): string => {
    if (n.startsWith('to') && n.length > 2) return n.slice(2);
    if (n.startsWith('from') && n.length > 4) return n.slice(4);
    return n;
  };

  const fieldPrefix = prefixOf(field.key);

  // Only enforce the From/To guard on fields that themselves have a prefix.
  // Neutral fields (weight, notes, quantity, etc.) can match any header.
  const prefixesAlign = (headerPrefix: 'from' | 'to' | null): boolean => {
    if (fieldPrefix === null) return true;
    if (headerPrefix === null) return true;
    return fieldPrefix === headerPrefix;
  };

  const normalizedKey = norm(field.key);
  const strippedKey = stripFromTo(normalizedKey);
  const aliases = [field.label, ...(field.aliases ?? [])].filter((a): a is string => typeof a === 'string' && a.length > 0);
  const normalizedAliases = aliases.map(norm);
  // Include prefix-stripped variants alongside the raw normalized aliases.
  // De-dup while preserving the descending-length ordering so the longest
  // match wins in steps 3 and 4.
  const aliasCandidatesSet = new Set<string>();
  for (const a of normalizedAliases) {
    aliasCandidatesSet.add(a);
    aliasCandidatesSet.add(stripFromTo(a));
  }
  const aliasCandidates = Array.from(aliasCandidatesSet)
    .filter((a) => a.length > 0)
    .sort((a, b) => b.length - a.length);
  const normalizedCols = customerColumns.map(norm);

  // 1. Exact match against the field key OR the key with the from/to prefix
  //    stripped (so `toContact` matches raw header `Contact`).
  for (let i = 0; i < normalizedCols.length; i++) {
    if (normalizedCols[i] === normalizedKey) return customerColumns[i];
    if (strippedKey.length > 0 && normalizedCols[i] === strippedKey) return customerColumns[i];
  }

  // 2. Exact match against label / alias (including the prefix-stripped
  //    variants). Longer aliases are checked first so `contactphone` beats
  //    `contact` when both are candidates for the same field's alias set.
  for (const alias of aliasCandidates) {
    for (let i = 0; i < normalizedCols.length; i++) {
      if (normalizedCols[i] === alias) return customerColumns[i];
    }
  }

  // 3. StartsWith prefix match. Iterate aliases longest-first so the outer
  //    loop biases toward the most specific alias per field.
  for (const alias of aliasCandidates) {
    if (alias.length < 3) continue;
    for (let i = 0; i < normalizedCols.length; i++) {
      if (!prefixesAlign(prefixOf(customerColumns[i]))) continue;
      const c = normalizedCols[i];
      if (c.startsWith(alias) || alias.startsWith(c)) return customerColumns[i];
    }
  }

  // 4. Substring match, guarded by prefix alignment AND minimum alias length
  //    of 3 characters. Longest-first alias iteration prevents `contact`
  //    (len 7) on `toContact` from grabbing a header like `ContactPhone`
  //    that `contactphone` (len 12) on `toContactPhone` should own.
  for (const alias of aliasCandidates) {
    if (alias.length < 3) continue;
    for (let i = 0; i < normalizedCols.length; i++) {
      if (!prefixesAlign(prefixOf(customerColumns[i]))) continue;
      const c = normalizedCols[i];
      if (c.includes(alias) || alias.includes(c)) return customerColumns[i];
    }
  }

  return '';
}
