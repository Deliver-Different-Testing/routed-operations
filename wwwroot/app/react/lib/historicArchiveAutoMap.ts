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
  JobNumber: 'Job Number',
  JobDate: 'Book Date',
  PickupTime: 'PU Time',
  CompletedTime: 'POD Time',
  ClientCode: 'Client Code',
  ClientId: 'Client ID',
  ClientRefA: 'Ref A',
  ClientRefB: 'Ref B',
  OurRef: 'Our Ref',
  CustomerName: 'Company',
  DeliveryAddress1: 'Address',
  DeliveryAddress2: 'Unit/Suite',
  DeliveryAddressCity: 'City',
  DeliveryPostCode: 'Zip Code',
  PickupAddress1: 'From Address',
  PickupAddress2: 'From Unit/Suite',
  PickupAddressCity: 'From City',
  PickupPostCode: 'From Zip Code',
  CourierCode: 'Courier',
  CourierId: 'Courier ID',
  Amount: 'Pricing',
  Weight: 'Weight',
  Quantity: 'Quantity',
  Notes: 'Notes',
  PodName: 'POD Name',
  CourierPayment: 'Courier Payment',
  CourierFuel: 'Courier Fuel',
  CourierBonus: 'Courier Bonus',
  FuelSurchargeAmount: 'Fuel Surcharge',
  PpdAmount: 'PPD Amount',
  PpdExclusiveAmount: 'PPD Exclusive Amount',
  RawBaseAmount: 'Raw Base Amount',
};

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

  // Delivery party + address
  customer: 'CustomerName',
  customername: 'CustomerName',
  tocompany: 'CustomerName',
  tocontact: 'CustomerName',
  deliverycompany: 'CustomerName',
  companyname: 'CustomerName',
  deliveryaddress: 'DeliveryAddress1',
  deliveryaddress1: 'DeliveryAddress1',
  address1: 'DeliveryAddress1',
  toaddress: 'DeliveryAddress1',
  deliveryaddress2: 'DeliveryAddress2',
  address2: 'DeliveryAddress2',
  deliveryaddress3: 'DeliveryAddressCity',
  suburb: 'DeliveryAddressCity',
  tosuburb: 'DeliveryAddressCity',
  deliverysuburb: 'DeliveryAddressCity',
  city: 'DeliveryAddressCity',
  tocity: 'DeliveryAddressCity',
  deliverycity: 'DeliveryAddressCity',
  deliveryaddress4: 'DeliveryAddressCity',
  town: 'DeliveryAddressCity',
  deliverypostcode: 'DeliveryPostCode',
  postcode: 'DeliveryPostCode',
  postalcode: 'DeliveryPostCode',
  zip: 'DeliveryPostCode',
  zipcode: 'DeliveryPostCode',
  topostcode: 'DeliveryPostCode',
  deliverypostal: 'DeliveryPostCode',

  // Pickup party + address
  pickupcompany: 'PickupAddress1',
  fromcompany: 'PickupAddress1',
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
  pickuppostcode: 'PickupPostCode',
  frompostcode: 'PickupPostCode',
  fromzip: 'PickupPostCode',
  fromzipcode: 'PickupPostCode',

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
  podname: 'PodName',
  signedby: 'PodName',
  receivedby: 'PodName',
  signature: 'PodName',
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
