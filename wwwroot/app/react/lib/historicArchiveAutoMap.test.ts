// Unit tests for the Historic Archive Upload Map-Columns auto-mapper.
// Covers the three-tier match: normalized exact, alias-table, no-match.

import { describe, expect, it } from 'vitest';
import { autoMapHeaders, labelForCanonicalField, normalize } from './historicArchiveAutoMap';

// Match HistoricArchiveField.All on the server (Steve 2026-09-03 expansion).
// If the server field list moves, this constant + the assertion set need to
// move with it - see HistoricArchiveDtos.cs.
const CANONICAL = [
  // Core job + timing
  'JobNumber', 'JobDate', 'PickupTime', 'CompletedTime',
  'RequiredDeliveryTime', 'DeliverByTime', 'PickupArrivalTime', 'DeliveryArrivalTime',
  // Client + references
  'ClientCode', 'ClientId',
  'ClientRefA', 'ClientRefB', 'ClientRefC', 'OurRef',
  'Connote', 'Barcode', 'CustomJobName',
  'TextRef1', 'TextRef2', 'TextRef3', 'TextRef4',
  'NumRef1', 'NumRef2', 'NumRef3', 'NumRef4',
  // Delivery
  'CustomerName', 'DeliveryAddress1', 'DeliveryAddress2', 'DeliveryAddress4',
  'DeliveryAddressCity', 'DeliveryState', 'DeliveryPostCode',
  'DeliveryContact', 'DeliveryPhone',
  // Pickup
  'PickupCompany', 'PickupAddress1', 'PickupAddress2', 'PickupAddress3', 'PickupAddress4',
  'PickupAddressCity', 'PickupState', 'PickupPostCode',
  'PickupContact', 'PickupPhone',
  // Order-level contact
  'Contact', 'ContactPhone',
  // Courier
  'CourierCode', 'CourierId',
  // Freight
  'Amount', 'Weight', 'Quantity',
  // Notes + POD
  'Notes', 'ClientNotes', 'InternalNotes', 'PodName',
  // Money
  'CourierPayment', 'CourierFuel', 'CourierBonus', 'CourierPercentage', 'FuelSurchargeAmount',
  'PpdAmount', 'PpdExclusiveAmount', 'RawBaseAmount',
  // Service / booking metadata
  'Speed', 'ServiceName', 'VehicleName', 'BookedBy', 'RunName', 'ScheduleName',
];

describe('normalize', () => {
  it('strips punctuation, spaces + lowercases', () => {
    expect(normalize('Customer Name')).toBe('customername');
    expect(normalize('Delivery Address 1')).toBe('deliveryaddress1');
    expect(normalize('POD Date/Time')).toBe('poddatetime');
    expect(normalize('Ref#2')).toBe('ref2');
    expect(normalize('  MC-8  ')).toBe('mc8');
    expect(normalize('')).toBe('');
    expect(normalize('!!!')).toBe('');
  });
});

describe('autoMapHeaders - normalised exact match tier', () => {
  it('matches PascalCase to PascalCase header', () => {
    const m = autoMapHeaders(['JobNumber', 'ClientCode', 'CourierBonus'], CANONICAL);
    expect(m).toEqual({
      JobNumber: 'JobNumber',
      ClientCode: 'ClientCode',
      CourierBonus: 'CourierBonus',
    });
  });

  it('matches spaced human header to concatenated canonical', () => {
    const m = autoMapHeaders(['Customer Name', 'Delivery Post Code', 'Courier ID'], CANONICAL);
    expect(m['Customer Name']).toBe('CustomerName');
    expect(m['Delivery Post Code']).toBe('DeliveryPostCode');
    expect(m['Courier ID']).toBe('CourierId');
  });

  it('preserves original header key casing in the mapping dict', () => {
    // The commit request uses the ORIGINAL header string as the map key
    // (not a normalized form), so the dict must key on it exactly.
    const m = autoMapHeaders(['Customer Name'], CANONICAL);
    expect(Object.keys(m)).toEqual(['Customer Name']);
  });
});

describe('autoMapHeaders - alias table tier', () => {
  it('resolves JR / OTG vendor headers via aliases', () => {
    const m = autoMapHeaders(
      [
        'CTN',                       // -> Quantity (cartons)
        'Total Price',               // -> Amount
        'Total Fuel',                // -> FuelSurchargeAmount
        'PPD',                       // -> PpdAmount
        'PPDEx',                     // -> PpdExclusiveAmount
        'RBA',                       // -> RawBaseAmount
        'CourierPay',                // -> CourierPayment
        'Delivery Address 3',        // -> DeliveryAddressCity
        'Delivery Address 4',        // -> DeliveryAddressCity (fallback)
        'OrderTrackingID',           // -> JobNumber
        'POD Date/Time',             // -> CompletedTime
        'Ref#',                      // -> ClientRefA (via "ref" alias)
        'Historic Base',             // -> Amount
      ],
      CANONICAL,
    );
    expect(m['CTN']).toBe('Quantity');
    expect(m['Total Price']).toBe('Amount');
    expect(m['Total Fuel']).toBe('FuelSurchargeAmount');
    expect(m['PPD']).toBe('PpdAmount');
    expect(m['PPDEx']).toBe('PpdExclusiveAmount');
    expect(m['RBA']).toBe('RawBaseAmount');
    expect(m['CourierPay']).toBe('CourierPayment');
    expect(m['Delivery Address 3']).toBe('DeliveryAddressCity');
    // 2026-09-03: "Delivery Address 4" now matches the new DeliveryAddress4
    // canonical via tier-1 normalised exact match, overriding the old
    // collapse-to-City alias (which only existed because Line 4 had no
    // dedicated target).
    expect(m['Delivery Address 4']).toBe('DeliveryAddress4');
    expect(m['OrderTrackingID']).toBe('JobNumber');
    expect(m['POD Date/Time']).toBe('CompletedTime');
    expect(m['Ref#']).toBe('ClientRefA');
    expect(m['Historic Base']).toBe('Amount');
  });

  it('is case + spacing insensitive on alias keys', () => {
    const m = autoMapHeaders(['total price', 'TOTAL PRICE', '  Total  Price  '], CANONICAL);
    expect(m['total price']).toBe('Amount');
    expect(m['TOTAL PRICE']).toBe('Amount');
    expect(m['  Total  Price  ']).toBe('Amount');
  });

  it('never resolves an alias whose target is not in the canonical list', () => {
    // If a future server release drops the FuelSurchargeAmount field,
    // "Total Fuel" must NOT surface as a stale suggestion.
    const trimmed = CANONICAL.filter((c) => c !== 'FuelSurchargeAmount');
    const m = autoMapHeaders(['Total Fuel'], trimmed);
    expect(m['Total Fuel']).toBeUndefined();
  });
});

describe('labelForCanonicalField - client-facing labels', () => {
  it('returns the curated label for known canonical fields', () => {
    expect(labelForCanonicalField('JobNumber')).toBe('Job Number');
    expect(labelForCanonicalField('JobDate')).toBe('Book Date');
    expect(labelForCanonicalField('ClientRefA')).toBe('Ref A');
    expect(labelForCanonicalField('ClientRefB')).toBe('Ref B');
    expect(labelForCanonicalField('OurRef')).toBe('Our Ref');
    expect(labelForCanonicalField('CustomerName')).toBe('Company');
    expect(labelForCanonicalField('DeliveryAddress1')).toBe('Address');
    expect(labelForCanonicalField('DeliveryAddress2')).toBe('Unit/Suite');
    expect(labelForCanonicalField('DeliveryAddressCity')).toBe('City');
    expect(labelForCanonicalField('DeliveryPostCode')).toBe('Zip Code');
    expect(labelForCanonicalField('PickupAddress1')).toBe('From Address');
    expect(labelForCanonicalField('CourierCode')).toBe('Courier');
    expect(labelForCanonicalField('CourierId')).toBe('Courier ID');
    expect(labelForCanonicalField('Amount')).toBe('Pricing');
    expect(labelForCanonicalField('PodName')).toBe('POD Name');
    expect(labelForCanonicalField('CompletedTime')).toBe('POD Time');
    expect(labelForCanonicalField('FuelSurchargeAmount')).toBe('Fuel Surcharge');
    expect(labelForCanonicalField('PpdAmount')).toBe('PPD Amount');
  });

  it('falls back to the raw name for an unknown field', () => {
    expect(labelForCanonicalField('SomeNewField')).toBe('SomeNewField');
  });
});

describe('autoMapHeaders - display labels also work as auto-map hits', () => {
  it('picks up canonical fields when the header uses the friendly label wording', () => {
    // Operator names their column "Job Number" (matches Bulk Import + POD
    // page label). Both variants should auto-map to JobNumber.
    const m = autoMapHeaders(
      ['Job Number', 'Book Date', 'Ref A', 'Ref B', 'Our Ref', 'PPD Amount', 'Zip Code'],
      CANONICAL,
    );
    expect(m['Job Number']).toBe('JobNumber');
    expect(m['Book Date']).toBe('JobDate');
    expect(m['Ref A']).toBe('ClientRefA');
    expect(m['Ref B']).toBe('ClientRefB');
    expect(m['Our Ref']).toBe('OurRef');
    expect(m['PPD Amount']).toBe('PpdAmount');
    expect(m['Zip Code']).toBe('DeliveryPostCode');
  });
});

describe('autoMapHeaders - unmatched headers', () => {
  it('leaves genuinely unknown headers unmapped', () => {
    const m = autoMapHeaders(['Sparklepony', 'Column11', '   ', ''], CANONICAL);
    expect(m['Sparklepony']).toBeUndefined();
    expect(m['Column11']).toBeUndefined();
    expect(m['   ']).toBeUndefined();
    expect(m['']).toBeUndefined();
  });
});

describe('autoMapHeaders - OTG historic spreadsheet shape (Steve 2026-09-03)', () => {
  it('maps the real OTG_JOBS_COMBINED headers end-to-end', () => {
    // Header set copied verbatim from the OTG CSV Steve provided
    // 2026-09-03: OTG Clients - OTG_JOBS_COMBINED_010125_TO_071226.csv.
    const headers = [
      'OrderTrackingID', 'Client Code', 'Company Name', 'Ref#',
      'Pieces', 'Weight',
      'Pickup Company', 'Pickup City', 'Pickup State',
      'Delivery Company', 'Delivery City', 'Delivery State',
      'Grand Total', 'Driver Pay',
      '[P] Target From', '[D] Target From',
      '[P] Arrival', '[P] Departure',
      'POD Name', 'POD Date/Time',
      'CSR', 'Status',
      'Pricing Mode', 'Service', 'Vehicle',
      'DriverNo', 'Driver Quote',
      'Pickup Zip', 'Delivery Zip',
      'Packages', 'Documents',
      'Ref#2', 'Type', 'Driver Class', 'Master Contractor/Agent',
    ];
    const m = autoMapHeaders(headers, CANONICAL);

    // Core job identity
    expect(m['OrderTrackingID']).toBe('JobNumber');
    expect(m['Client Code']).toBe('ClientCode');
    expect(m['Ref#']).toBe('ClientRefA');
    expect(m['Ref#2']).toBe('ClientRefB');

    // Delivery party (Company Name goes to delivery-side company)
    expect(m['Company Name']).toBe('CustomerName');
    expect(m['Delivery Company']).toBe('CustomerName');
    expect(m['Delivery City']).toBe('DeliveryAddressCity');
    expect(m['Delivery State']).toBe('DeliveryState');
    expect(m['Delivery Zip']).toBe('DeliveryPostCode');

    // Pickup party (NEW: PickupCompany canonical, not collapsed to
    // PickupAddress1 like the pre-expansion table did).
    expect(m['Pickup Company']).toBe('PickupCompany');
    expect(m['Pickup City']).toBe('PickupAddressCity');
    expect(m['Pickup State']).toBe('PickupState');
    expect(m['Pickup Zip']).toBe('PickupPostCode');

    // Freight + money
    expect(m['Pieces']).toBe('Quantity');
    expect(m['Weight']).toBe('Weight');
    expect(m['Grand Total']).toBe('Amount');
    expect(m['Driver Pay']).toBe('CourierPayment');

    // Timing / milestones (OTG's bracket-prefixed columns)
    expect(m['[P] Target From']).toBe('RequiredDeliveryTime');
    expect(m['[D] Target From']).toBe('DeliverByTime');
    expect(m['[P] Arrival']).toBe('PickupArrivalTime');
    expect(m['POD Name']).toBe('PodName');
    expect(m['POD Date/Time']).toBe('CompletedTime');

    // Service / Vehicle now auto-alias to the text-name canonicals which
    // the server resolves against tucJobType / VehicleSize at commit
    // time. CSR is still deliberately NOT auto-aliased - staff name
    // lookup is ambiguous (first-name-only) so operator maps manually
    // only when the source file carries pre-resolved staff IDs.
    expect(m['CSR']).toBeUndefined();
    expect(m['Service']).toBe('ServiceName');
    expect(m['Vehicle']).toBe('VehicleName');
    expect(m['DriverNo']).toBe('CourierId');

    // Columns the operator will skip explicitly (no alias intentionally).
    // "Status" is deliberately unmapped for now - the historic uploader
    // hard-codes UcjbStatus = 6 regardless (see HistoricArchiveService
    // comment "billing-sentinel recipe").
    expect(m['Status']).toBeUndefined();
    expect(m['Pricing Mode']).toBeUndefined();
    expect(m['Driver Quote']).toBeUndefined();
    expect(m['Documents']).toBeUndefined();
    expect(m['Type']).toBeUndefined();
    expect(m['Driver Class']).toBeUndefined();
    expect(m['Master Contractor/Agent']).toBeUndefined();
  });

  it('maps the new contact + descriptive fields when the spreadsheet uses friendly wording', () => {
    const m = autoMapHeaders(
      [
        'Ref C', 'Connote', 'Barcode', 'Custom Job Name',
        'Client Notes', 'Internal Notes',
        'Required Delivery Time', 'Deliver By Time',
        'Delivery Contact', 'Delivery Phone',
        'Pickup Contact', 'Pickup Phone',
        'Contact', 'Contact Phone',
        'Run Name', 'Schedule Name',
        'Text Ref 1', 'Num Ref 1',
      ],
      CANONICAL,
    );
    expect(m['Ref C']).toBe('ClientRefC');
    expect(m['Connote']).toBe('Connote');
    expect(m['Barcode']).toBe('Barcode');
    expect(m['Custom Job Name']).toBe('CustomJobName');
    expect(m['Client Notes']).toBe('ClientNotes');
    expect(m['Internal Notes']).toBe('InternalNotes');
    expect(m['Required Delivery Time']).toBe('RequiredDeliveryTime');
    expect(m['Deliver By Time']).toBe('DeliverByTime');
    expect(m['Delivery Contact']).toBe('DeliveryContact');
    expect(m['Delivery Phone']).toBe('DeliveryPhone');
    expect(m['Pickup Contact']).toBe('PickupContact');
    expect(m['Pickup Phone']).toBe('PickupPhone');
    expect(m['Contact']).toBe('Contact');
    expect(m['Contact Phone']).toBe('ContactPhone');
    expect(m['Run Name']).toBe('RunName');
    expect(m['Schedule Name']).toBe('ScheduleName');
    expect(m['Text Ref 1']).toBe('TextRef1');
    expect(m['Num Ref 1']).toBe('NumRef1');
  });
});

describe('autoMapHeaders - full JR spreadsheet shape', () => {
  it('maps the real JR morning file headers end-to-end', () => {
    const headers = [
      'JobNumber',
      'Customer Name',
      'CTN',
      'Delivery Address 1',
      'Delivery Address 2',
      'Delivery Address 3',
      'Delivery Address 4',
      'Delivery Address 5',
      'Delivery Post Code',
      'Column11',
      'Courier Number',
      'Column13',
      'Run Number',
      'Column15',
      'Courier ID',
      'Column17',
      'Historic Base',
      'Column19',
      'Historic Extra Box Rate',
      'Column21',
      'Total Price',
      'FSA Base',
      'FSA Extra',
      'Total Fuel',
      'PPD',
      'PPDEx',
      'RBA',
      'CourierPercentage',
      'CourierPay',
      'CourierBonus',
      'CourierFuel',
      'ClientCode',
      'JobDate',
    ];
    const m = autoMapHeaders(headers, CANONICAL);
    // Spot-check the operator's high-value fields.
    expect(m['JobNumber']).toBe('JobNumber');
    expect(m['JobDate']).toBe('JobDate');
    expect(m['ClientCode']).toBe('ClientCode');
    expect(m['Customer Name']).toBe('CustomerName');
    expect(m['CTN']).toBe('Quantity');
    expect(m['Delivery Address 1']).toBe('DeliveryAddress1');
    expect(m['Delivery Address 2']).toBe('DeliveryAddress2');
    expect(m['Delivery Address 3']).toBe('DeliveryAddressCity');
    expect(m['Delivery Post Code']).toBe('DeliveryPostCode');
    expect(m['Courier ID']).toBe('CourierId');
    expect(m['Total Price']).toBe('Amount');
    expect(m['Total Fuel']).toBe('FuelSurchargeAmount');
    expect(m['PPD']).toBe('PpdAmount');
    expect(m['PPDEx']).toBe('PpdExclusiveAmount');
    expect(m['RBA']).toBe('RawBaseAmount');
    expect(m['CourierPay']).toBe('CourierPayment');
    expect(m['CourierBonus']).toBe('CourierBonus');
    expect(m['CourierFuel']).toBe('CourierFuel');
    // Filler columns from the xls stay unmapped.
    expect(m['Column11']).toBeUndefined();
    expect(m['Column13']).toBeUndefined();
  });
});
