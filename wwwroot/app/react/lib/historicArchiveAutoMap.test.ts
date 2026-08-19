// Unit tests for the Historic Archive Upload Map-Columns auto-mapper.
// Covers the three-tier match: normalized exact, alias-table, no-match.

import { describe, expect, it } from 'vitest';
import { autoMapHeaders, labelForCanonicalField, normalize } from './historicArchiveAutoMap';

const CANONICAL = [
  'JobNumber',
  'JobDate',
  'PickupTime',
  'CompletedTime',
  'ClientCode',
  'ClientId',
  'ClientRefA',
  'ClientRefB',
  'OurRef',
  'CustomerName',
  'DeliveryAddress1',
  'DeliveryAddress2',
  'DeliveryAddressCity',
  'DeliveryPostCode',
  'PickupAddress1',
  'PickupAddress2',
  'PickupAddressCity',
  'PickupPostCode',
  'CourierCode',
  'CourierId',
  'Amount',
  'Weight',
  'Quantity',
  'Notes',
  'PodName',
  'CourierPayment',
  'CourierFuel',
  'CourierBonus',
  'FuelSurchargeAmount',
  'PpdAmount',
  'PpdExclusiveAmount',
  'RawBaseAmount',
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
    expect(m['Delivery Address 4']).toBe('DeliveryAddressCity');
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
