import type { ClientDto, ClientSettingsDto } from '../../services/clientsService';
import type {
  BulkImportJobCreateDto,
  ParsedFile,
  PickupJobToCreateResponse,
} from '../../services/bulkImportService';

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
}

export interface WizardState {
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
  fixedAddresses: Record<number, { lat: number; lng: number }>;
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
  kmRatedConfirmed: boolean;
  failedImportJobs: BulkImportJobCreateDto[];
  // Pickup booking (Step 8). pickupJobPayload is the earliest-cutoff pickup
  // job aggregated across per-depot imports (matches
  // homeControl.js:3226-3229). BookPickupModal reads from this to hydrate
  // its form defaults.
  pickupJobPayload: PickupJobToCreateResponse | null;
}

function defaultBookDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function initialWizardState(): WizardState {
  return {
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
    },
    fixedZips: {},
    fixedAddresses: {},
    fixedFromAddresses: {},
    selectedRegions: new Set(),
    rateByDistanceDate: null,
    depots: [],
    currentDepotIndex: 0,
    perDepotResults: [],
    clientSettings: null,
    bookDate: defaultBookDate(),
    bookTime: '',
    speedId: 0,
    scheduleId: null,
    kmRatedRows: [],
    kmRatedSelected: new Set(),
    kmRatedConfirmed: false,
    failedImportJobs: [],
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
  | { type: 'SET_FIXED_ZIP'; badZip: string; corrected: string }
  | { type: 'SET_FIXED_ADDRESS'; rowIndex: number; coords: { lat: number; lng: number } }
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
  | { type: 'SET_CURRENT_DEPOT'; index: number }
  | { type: 'ADD_PER_DEPOT_RESULT'; result: PerDepotResult }
  | { type: 'RESET_PER_DEPOT_RESULTS' }
  | { type: 'SET_KMRATED'; rows: BulkImportJobCreateDto[] }
  | { type: 'TOGGLE_KMRATED_ROW'; index: number }
  | { type: 'SET_ALL_KMRATED_SELECTED'; selected: boolean }
  | { type: 'SET_KMRATED_CONFIRMED'; value: boolean }
  | { type: 'SET_FAILED_IMPORT_JOBS'; jobs: BulkImportJobCreateDto[] }
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
      return initialWizardState();
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
        const fresh = initialWizardState();
        return { ...fresh, client: action.client };
      }
      return { ...state, client: action.client };
    }
    case 'SET_FILE':
      return { ...state, file: action.file };
    case 'SET_IMPORT_TYPE':
      return { ...state, importType: action.importType };
    case 'SET_PARSED':
      return { ...state, parsed: action.parsed };
    case 'SET_MAPPING':
      return { ...state, mapping: action.mapping };
    case 'PATCH_MAPPING':
      return { ...state, mapping: { ...state.mapping, [action.field]: action.column } };
    case 'SET_OPTIONS':
      return { ...state, options: { ...state.options, ...action.options } };
    case 'SET_FIXED_ZIP':
      return {
        ...state,
        fixedZips: { ...state.fixedZips, [action.badZip]: action.corrected },
      };
    case 'SET_FIXED_ADDRESS':
      return {
        ...state,
        fixedAddresses: { ...state.fixedAddresses, [action.rowIndex]: action.coords },
      };
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
    case 'SET_CURRENT_DEPOT':
      return { ...state, currentDepotIndex: action.index };
    case 'ADD_PER_DEPOT_RESULT':
      return { ...state, perDepotResults: [...state.perDepotResults, action.result] };
    case 'RESET_PER_DEPOT_RESULTS':
      return { ...state, perDepotResults: [] };
    case 'SET_KMRATED': {
      // Default: pre-tick every km-rated row (matches homeControl.js
      // checkUncheckAll behaviour at load time).
      const all = new Set<number>();
      for (let i = 0; i < action.rows.length; i++) all.add(i);
      return { ...state, kmRatedRows: action.rows, kmRatedSelected: all };
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

export function urgentFieldsFor(
  isUsTenant: boolean,
  jobType: ImportType,
  autogenerateJobNumber: boolean,
  routeFromClientSite: boolean = false,
  clientOverrides?: UrgentFieldsClientOverrides,
  stockSizeOverridden: boolean = false
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
    base.push({ key: 'bookDate', label: 'Book Date', aliases: ['Book Date', 'Date', 'Delivery Date'], showFor: 'both' });
    base.push({ key: 'bookTime', label: 'Book Time', aliases: ['Book Time', 'Time', 'Ready Time'], showFor: 'both' });
  }

  // fromContact always shown (MapColumnsModal hides when Override From Contact set).
  base.push({
    key: 'fromContact',
    label: 'From Contact',
    aliases: ['Sender', 'Shipper', 'Origin Contact', 'Pickup Contact'],
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
    aliases: ['Qty', 'Items', 'NumberOfItems', 'ItemCount', 'Pieces', 'Pcs', 'Count', 'Boxes', 'Cartons'],
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
      label: 'Weight',
      aliases: ['Weight', 'Wgt', 'Lbs', 'Pounds', 'Kg', 'Kgs', 'PackageWeight'],
      showFor: 'both',
    });
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

  return base;
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
export function autoMatchColumn(field: UrgentField, customerColumns: string[]): string {
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
