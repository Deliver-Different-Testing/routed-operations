// Historic Archive Upload - auto-mapping heuristic for the wizard's
// Map Columns step + display-label lookup for canonical fields.
//
// Labels are chosen for parity with two sibling surfaces so operators
// see consistent wording across the app:
//   - Bulk Import wizard's Map Columns step (Job Number, Book Date,
//     Ref A, Ref B, Our Ref, Quantity, Weight, Notes, Company,
//     Address, Unit/Suite, City, Zip Code, From Address, From City,
//     From Zip Code, etc.)
//   - DespatchWeb POD page (POD Name, POD Time, Pricing, Courier,
//     Pickup, Delivery, Ref A / Ref B / Our Ref, etc.)
//
// Where neither surface has a matching field, a friendly Title-Case
// label is used (e.g. "Courier Payment", "Fuel Surcharge", "PPD
// Amount").
//
// Auto-mapping input: the parsed file's header list + the server's
// canonical field list. Output: header -> canonical mapping the
// wizard pre-selects.
//
// Three-tier match, most-specific first:
//   1. Normalized exact match. Both sides lowercased + non-alphanumerics
//      stripped, so "Customer Name" -> "customername" matches canonical
//      "CustomerName" -> "customername"; "Courier ID" -> "courierid"
//      matches canonical "CourierId" -> "courierid".
//   2. Alias table. Handles legacy / vendor-specific column names that
//      have no literal correspondence to the canonical vocabulary:
//      CTN -> Quantity, Total Price -> Amount, PPD -> PpdAmount, etc.
//      Aliases are keyed on their own normalized form so vendor casing
//      / spacing quirks (like "Total Price" vs "totalprice") don't
//      require duplicate entries. The display labels above are ALSO
//      registered as aliases so an operator's spreadsheet header like
//      "Job Number" (with the space) picks up the canonical JobNumber.
//   3. No match -> unmapped (operator picks manually).
//
// Aliases are additive only - never replace a stronger normalized
// match. If a header normalizes to a canonical field directly it wins.

/** Strip non-alphanumerics and lowercase.
 *  "Customer Name" -> "customername"; "Delivery Address 1" -> "deliveryaddress1". */
export function normalize(s: string): string {
  return (s || '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

/** Client-facing display label per canonical field, chosen for parity
 *  with the Bulk Import wizard's Map Columns step + the DespatchWeb POD
 *  page labels. Falls back to the raw canonical name for anything not
 *  listed here so a new canonical field always has *some* label until
 *  we curate one. */
const DISPLAY_LABELS: Record<string, string> = {
  // Core job + timing
  JobNumber: 'Job Number',
  JobDate: 'Book Date',
  PickupTime: 'PU Time',
  CompletedTime: 'POD Time',
  RequiredDeliveryTime: 'Required Delivery Time',
  DeliverByTime: 'Deliver By Time',
  PickupArrivalTime: 'Pickup Arrival Time',
  DeliveryArrivalTime: 'Delivery Arrival Time',
  // Client + references
  ClientCode: 'Client Code',
  ClientId: 'Client ID',
  ClientRefA: 'Ref A',
  ClientRefB: 'Ref B',
  ClientRefC: 'Ref C',
  OurRef: 'Our Ref',
  Connote: 'Connote',
  Barcode: 'Barcode',
  CustomJobName: 'Custom Job Name',
  TextRef1: 'Text Ref 1',
  TextRef2: 'Text Ref 2',
  TextRef3: 'Text Ref 3',
  TextRef4: 'Text Ref 4',
  NumRef1: 'Num Ref 1',
  NumRef2: 'Num Ref 2',
  NumRef3: 'Num Ref 3',
  NumRef4: 'Num Ref 4',
  // Delivery
  CustomerName: 'Company',
  DeliveryAddress1: 'Address',
  DeliveryAddress2: 'Unit/Suite',
  DeliveryAddress4: 'Address Line 4',
  DeliveryAddressCity: 'City',
  DeliveryState: 'State',
  DeliveryPostCode: 'Zip Code',
  DeliveryContact: 'Delivery Contact',
  DeliveryPhone: 'Delivery Phone',
  // Pickup
  PickupCompany: 'Pickup Company',
  PickupAddress1: 'From Address',
  PickupAddress2: 'From Unit/Suite',
  PickupAddress3: 'From Address Line 3',
  PickupAddress4: 'From Address Line 4',
  PickupAddressCity: 'From City',
  PickupState: 'From State',
  PickupPostCode: 'From Zip Code',
  PickupContact: 'Pickup Contact',
  PickupPhone: 'Pickup Phone',
  // Order-level contact
  Contact: 'Contact',
  ContactPhone: 'Contact Phone',
  // Courier
  CourierCode: 'Courier',
  CourierId: 'Courier ID',
  // Freight
  Amount: 'Pricing',
  Weight: 'Weight',
  Quantity: 'Quantity',
  // Notes + POD
  Notes: 'Notes',
  ClientNotes: 'Client Notes',
  InternalNotes: 'Internal Notes',
  PodName: 'POD Name',
  // Money
  CourierPayment: 'Courier Payment',
  CourierFuel: 'Courier Fuel',
  CourierBonus: 'Courier Bonus',
  CourierPercentage: 'Courier Percentage',
  FuelSurchargeAmount: 'Fuel Surcharge',
  PpdAmount: 'PPD Amount',
  PpdExclusiveAmount: 'PPD Exclusive Amount',
  RawBaseAmount: 'Raw Base Amount',
  // Service / booking metadata
  Speed: 'Speed / Service (ID)',
  ServiceName: 'Service Name (auto-resolves)',
  VehicleName: 'Vehicle Type (auto-resolves)',
  BookedBy: 'Booked By / CSR',
  RunName: 'Run Name',
  ScheduleName: 'Schedule Name',
};

/** Canonical field -> UI group name. Drives the optgroup rendering in
 *  the Map Columns dropdown so operators can scan the 60+ target list by
 *  category instead of scrolling a flat alphabetical dump. Fields not
 *  listed here render under "Other". */
export const FIELD_GROUPS: Record<string, string> = {
  JobNumber: 'Core job',
  JobDate: 'Core job',
  PickupTime: 'Core job',
  CompletedTime: 'Core job',
  RequiredDeliveryTime: 'Core job',
  DeliverByTime: 'Core job',
  PickupArrivalTime: 'Core job',
  DeliveryArrivalTime: 'Core job',
  ClientCode: 'Client & references',
  ClientId: 'Client & references',
  ClientRefA: 'Client & references',
  ClientRefB: 'Client & references',
  ClientRefC: 'Client & references',
  OurRef: 'Client & references',
  Connote: 'Client & references',
  Barcode: 'Client & references',
  CustomJobName: 'Client & references',
  TextRef1: 'Client & references',
  TextRef2: 'Client & references',
  TextRef3: 'Client & references',
  TextRef4: 'Client & references',
  NumRef1: 'Client & references',
  NumRef2: 'Client & references',
  NumRef3: 'Client & references',
  NumRef4: 'Client & references',
  CustomerName: 'Delivery',
  DeliveryAddress1: 'Delivery',
  DeliveryAddress2: 'Delivery',
  DeliveryAddress4: 'Delivery',
  DeliveryAddressCity: 'Delivery',
  DeliveryState: 'Delivery',
  DeliveryPostCode: 'Delivery',
  DeliveryContact: 'Delivery',
  DeliveryPhone: 'Delivery',
  PodName: 'Delivery',
  PickupCompany: 'Pickup',
  PickupAddress1: 'Pickup',
  PickupAddress2: 'Pickup',
  PickupAddress3: 'Pickup',
  PickupAddress4: 'Pickup',
  PickupAddressCity: 'Pickup',
  PickupState: 'Pickup',
  PickupPostCode: 'Pickup',
  PickupContact: 'Pickup',
  PickupPhone: 'Pickup',
  Contact: 'Contact',
  ContactPhone: 'Contact',
  CourierCode: 'Courier',
  CourierId: 'Courier',
  CourierPayment: 'Courier',
  CourierFuel: 'Courier',
  CourierBonus: 'Courier',
  CourierPercentage: 'Courier',
  Amount: 'Pricing',
  FuelSurchargeAmount: 'Pricing',
  PpdAmount: 'Pricing',
  PpdExclusiveAmount: 'Pricing',
  RawBaseAmount: 'Pricing',
  Weight: 'Freight',
  Quantity: 'Freight',
  Notes: 'Notes',
  ClientNotes: 'Notes',
  InternalNotes: 'Notes',
  Speed: 'Service / booking',
  ServiceName: 'Service / booking',
  VehicleName: 'Service / booking',
  BookedBy: 'Service / booking',
  RunName: 'Service / booking',
  ScheduleName: 'Service / booking',
};

/** Explicit order of the groups in the dropdown - matches Steve's
 *  recommended UI layout so the most-used fields (Core job / Client /
 *  Delivery / Pickup) surface first. */
export const GROUP_ORDER: string[] = [
  'Core job',
  'Client & references',
  'Delivery',
  'Pickup',
  'Contact',
  'Courier',
  'Pricing',
  'Freight',
  'Notes',
  'Service / booking',
  'Other',
];

/** Look up the client-facing label for a canonical field. Returns the
 *  raw name if the field is not in the table (safe fallback for a
 *  future server-added field that hasn't been curated yet). */
export function labelForCanonicalField(canonical: string): string {
  return DISPLAY_LABELS[canonical] ?? canonical;
}

/** Alias table: normalised header text -> canonical field name.
 *  Aliases are hand-picked from real-world OTG / JR / Kerran-style
 *  spreadsheets. If you add a new one, prefer the most common vendor
 *  wording (people import files exported by other TMS systems).
 *
 *  NOTE: keys are already normalised (spaces / punctuation stripped +
 *  lowercased). Don't add "Total Price" - add "totalprice". */
const ALIASES: Record<string, string> = {
  // Job identity
  ordertrackingid: 'JobNumber',
  orderid: 'JobNumber',
  jobno: 'JobNumber',
  jobnum: 'JobNumber',
  connote: 'JobNumber',
  reference: 'JobNumber',

  // Dates
  orderdate: 'JobDate',
  date: 'JobDate',
  bookdate: 'JobDate',
  completedtime: 'CompletedTime',
  poddatetime: 'CompletedTime',
  podtime: 'CompletedTime',
  poddate: 'CompletedTime',
  readytime: 'PickupTime',
  pickuptime: 'PickupTime',

  // Client
  client: 'ClientCode',
  customercode: 'ClientCode',
  accountcode: 'ClientCode',
  ref: 'ClientRefA',
  refa: 'ClientRefA',
  reference1: 'ClientRefA',
  ref1: 'ClientRefA',
  refb: 'ClientRefB',
  reference2: 'ClientRefB',
  ref2: 'ClientRefB',
  ourref: 'OurRef',

  // Delivery party + address. Now that PickupCompany + DeliveryContact
  // have dedicated targets, "Delivery Company" still routes to
  // CustomerName (the delivery-side name column) but "Pickup Company"
  // gets its own PickupCompany canonical (see pickup section below).
  customer: 'CustomerName',
  customername: 'CustomerName',
  tocompany: 'CustomerName',
  tocontact: 'CustomerName',
  deliverycompany: 'CustomerName',
  companyname: 'CustomerName',
  deliveryname: 'CustomerName',
  deliveryaddress: 'DeliveryAddress1',
  deliveryaddress1: 'DeliveryAddress1',
  address1: 'DeliveryAddress1',
  toaddress: 'DeliveryAddress1',
  deliveryaddress2: 'DeliveryAddress2',
  address2: 'DeliveryAddress2',
  // NOTE 2026-09-03: "Delivery Address 4" now resolves via the tier-1
  // normalised exact match to the new DeliveryAddress4 canonical (which
  // in turn writes to DeliveryAddressLine4). Pre-expansion the alias
  // "deliveryaddress4 -> DeliveryAddressCity" was a workaround for the
  // missing Line4 target - unnecessary now.
  deliveryaddress3: 'DeliveryAddressCity',
  suburb: 'DeliveryAddressCity',
  tosuburb: 'DeliveryAddressCity',
  deliverysuburb: 'DeliveryAddressCity',
  city: 'DeliveryAddressCity',
  tocity: 'DeliveryAddressCity',
  deliverycity: 'DeliveryAddressCity',
  town: 'DeliveryAddressCity',
  state: 'DeliveryState',
  deliverystate: 'DeliveryState',
  tostate: 'DeliveryState',
  region: 'DeliveryState',
  deliverypostcode: 'DeliveryPostCode',
  postcode: 'DeliveryPostCode',
  postalcode: 'DeliveryPostCode',
  zip: 'DeliveryPostCode',
  zipcode: 'DeliveryPostCode',
  topostcode: 'DeliveryPostCode',
  deliverypostal: 'DeliveryPostCode',
  tozip: 'DeliveryPostCode',
  deliveryzip: 'DeliveryPostCode',
  deliveryzipcode: 'DeliveryPostCode',
  deliverycontact: 'DeliveryContact',
  receiver: 'DeliveryContact',
  receivername: 'DeliveryContact',
  deliveryphone: 'DeliveryPhone',
  tophone: 'DeliveryPhone',
  receiverphone: 'DeliveryPhone',

  // Pickup party + address
  pickupcompany: 'PickupCompany',
  fromcompany: 'PickupCompany',
  sender: 'PickupCompany',
  sendername: 'PickupCompany',
  pickupname: 'PickupCompany',
  pickupaddress: 'PickupAddress1',
  pickupaddress1: 'PickupAddress1',
  fromaddress: 'PickupAddress1',
  fromaddress1: 'PickupAddress1',
  pickupaddress2: 'PickupAddress2',
  fromaddress2: 'PickupAddress2',
  pickupaddress3: 'PickupAddressCity',
  pickupsuburb: 'PickupAddressCity',
  pickupcity: 'PickupAddressCity',
  fromsuburb: 'PickupAddressCity',
  fromcity: 'PickupAddressCity',
  pickupstate: 'PickupState',
  fromstate: 'PickupState',
  pickuppostcode: 'PickupPostCode',
  frompostcode: 'PickupPostCode',
  fromzip: 'PickupPostCode',
  fromzipcode: 'PickupPostCode',
  pickupzip: 'PickupPostCode',
  pickupzipcode: 'PickupPostCode',
  pickupcontact: 'PickupContact',
  pickupphone: 'PickupPhone',
  fromphone: 'PickupPhone',
  senderphone: 'PickupPhone',
  contact: 'Contact',
  contactname: 'Contact',
  contactphone: 'ContactPhone',
  phone: 'ContactPhone',

  // Courier
  courier: 'CourierCode',
  couriercode: 'CourierCode',
  driver: 'CourierCode',
  drivercode: 'CourierCode',
  mccode: 'CourierCode',
  mcnumber: 'CourierCode',
  courierid: 'CourierId',
  driverid: 'CourierId',
  driverno: 'CourierId',
  couriernumber: 'CourierId',

  // Money
  totalprice: 'Amount',
  grandtotal: 'Amount',
  price: 'Amount',
  total: 'Amount',
  invoiceamount: 'Amount',
  jobamount: 'Amount',
  historicbase: 'Amount',
  courierpay: 'CourierPayment',
  driverpay: 'CourierPayment',
  courierpayment: 'CourierPayment',
  courierfuel: 'CourierFuel',
  driverfuel: 'CourierFuel',
  courierbonus: 'CourierBonus',
  driverbonus: 'CourierBonus',
  totalfuel: 'FuelSurchargeAmount',
  fuel: 'FuelSurchargeAmount',
  fuelsurcharge: 'FuelSurchargeAmount',
  fuelsurchargeamount: 'FuelSurchargeAmount',
  fsa: 'FuelSurchargeAmount',
  ppd: 'PpdAmount',
  ppdamount: 'PpdAmount',
  ppdex: 'PpdExclusiveAmount',
  ppdexclusive: 'PpdExclusiveAmount',
  ppdexclusiveamount: 'PpdExclusiveAmount',
  rba: 'RawBaseAmount',
  rawbase: 'RawBaseAmount',
  rawbaseamount: 'RawBaseAmount',

  // Freight
  weight: 'Weight',
  kg: 'Weight',
  kgs: 'Weight',
  wt: 'Weight',
  qty: 'Quantity',
  quantity: 'Quantity',
  ctn: 'Quantity',
  ctns: 'Quantity',
  cartons: 'Quantity',
  boxes: 'Quantity',
  units: 'Quantity',
  pieces: 'Quantity',
  items: 'Quantity',
  count: 'Quantity',

  // Notes + POD
  notes: 'Notes',
  comment: 'Notes',
  comments: 'Notes',
  remarks: 'Notes',
  clientnotes: 'ClientNotes',
  internalnotes: 'InternalNotes',
  podname: 'PodName',
  signedby: 'PodName',
  receivedby: 'PodName',
  signature: 'PodName',

  // Extra references (Steve 2026-09-03 minimum uplift).
  // Note: `connote` (unqualified) intentionally kept mapped to JobNumber
  // above for legacy JR-style spreadsheets that store the connote as
  // their sole job identifier. Operators with a distinct Connote column
  // can manually re-map or use "Conno" / "Consignment Number" alias.
  refc: 'ClientRefC',
  reference3: 'ClientRefC',
  ref3: 'ClientRefC',
  conno: 'Connote',
  consignmentnumber: 'Connote',
  scancode: 'Barcode',

  // Timing / milestone
  requireddeliverytime: 'RequiredDeliveryTime',
  deliverbytime: 'DeliverByTime',
  ptargetfrom: 'RequiredDeliveryTime',       // OTG "[P] Target From"
  dtargetfrom: 'DeliverByTime',              // OTG "[D] Target From"
  pickuparrivaltime: 'PickupArrivalTime',
  parrival: 'PickupArrivalTime',             // OTG "[P] Arrival"
  deliveryarrivaltime: 'DeliveryArrivalTime',
  darrival: 'DeliveryArrivalTime',           // OTG "[D] Arrival"

  // Service / booking metadata.
  // NOTE: "csr" / "bookedby" / "operator" are NOT auto-aliased -
  // BookedBy -> UcjbOpId is an int FK to tucStaff with no name
  // lookup (first-name-only ambiguity), so a text CSR name would
  // reject the row. Operator maps CSR manually only when the file
  // ships pre-resolved staff IDs.
  //
  // "service" / "vehicle" ARE aliased, but to ServiceName /
  // VehicleName - text-preserving canonicals that the server
  // resolves to UcjbSpeed / UcjbSize at commit via tucJobType +
  // VehicleSize lookups. Unresolved names silently leave the FK
  // NULL rather than rejecting the row.
  service: 'ServiceName',
  servicetype: 'ServiceName',
  servicename: 'ServiceName',
  vehicle: 'VehicleName',
  vehicletype: 'VehicleName',
  vehiclename: 'VehicleName',
  runname: 'RunName',
  runno: 'RunName',
  schedulename: 'ScheduleName',
  schedule: 'ScheduleName',
  courierpercentage: 'CourierPercentage',

  // OTG extra reference (Ref#2 already normalizes to "ref2" -> ClientRefB
  // above). Extra Ref numbers land in the Text/Num Ref slots via alias.
  textref1: 'TextRef1',
  textref2: 'TextRef2',
  textref3: 'TextRef3',
  textref4: 'TextRef4',
  numref1: 'NumRef1',
  numref2: 'NumRef2',
  numref3: 'NumRef3',
  numref4: 'NumRef4',
};

// Seed the alias table with the DISPLAY_LABELS so operators whose
// spreadsheets use the friendly wording ("Job Number", "Ref A", "PPD
// Amount") also get an auto-map hit. Curated aliases above override
// these seeded ones so a vendor-specific alias always wins when it
// contradicts (nothing in the seed actually does today).
for (const [canonical, label] of Object.entries(DISPLAY_LABELS)) {
  const norm = normalize(label);
  if (norm && !(norm in ALIASES)) ALIASES[norm] = canonical;
}

/**
 * Build the header -> canonical mapping the wizard pre-selects. Runs
 * the three-tier match described in the module header for each header.
 *
 * @param headers   The parsed file's header list, in file order.
 * @param canonical The server-supplied canonical field list.
 * @returns A dict keyed on the ORIGINAL header (case + spacing preserved
 *          because that's what the mapping payload uses as its key).
 *          Unmapped headers are omitted so the caller can distinguish
 *          "picked (skip)" from "not auto-suggested".
 */
export function autoMapHeaders(
  headers: string[],
  canonical: string[],
): Record<string, string> {
  const canonicalByNorm = new Map<string, string>();
  for (const c of canonical) canonicalByNorm.set(normalize(c), c);
  const canonicalSet = new Set(canonical);

  const mapping: Record<string, string> = {};

  for (const header of headers) {
    if (!header) continue;
    const norm = normalize(header);
    if (!norm) continue;

    // 1. Normalized exact match against canonical.
    const direct = canonicalByNorm.get(norm);
    if (direct) {
      mapping[header] = direct;
      continue;
    }

    // 2. Alias table (aliases must resolve to a real canonical field,
    //    otherwise ignore the alias).
    const alias = ALIASES[norm];
    if (alias && canonicalSet.has(alias)) {
      mapping[header] = alias;
      continue;
    }
    // 3. No match - leave unmapped.
  }

  return mapping;
}
