import { describe, expect, it } from 'vitest';
import {
  cityLabel,
  currencyCode,
  currencySymbol,
  postcodeLabel,
  stateLabel,
} from './tenantLabels';

describe('postcodeLabel', () => {
  it('US short returns "Zip"', () => {
    expect(postcodeLabel(true, true)).toBe('Zip');
  });
  it('US long returns "Zip Code"', () => {
    expect(postcodeLabel(true, false)).toBe('Zip Code');
  });
  it('NZ short returns "Postcode"', () => {
    expect(postcodeLabel(false, true)).toBe('Postcode');
  });
  it('NZ long returns "Postal Code"', () => {
    expect(postcodeLabel(false, false)).toBe('Postal Code');
  });
  it('short is the default', () => {
    expect(postcodeLabel(true)).toBe('Zip');
    expect(postcodeLabel(false)).toBe('Postcode');
  });
});

describe('stateLabel', () => {
  it('US returns "State"', () => {
    expect(stateLabel(true)).toBe('State');
  });
  it('NZ returns "Region"', () => {
    expect(stateLabel(false)).toBe('Region');
  });
});

describe('cityLabel', () => {
  it('US returns "City"', () => {
    expect(cityLabel(true)).toBe('City');
  });
  it('NZ returns "Suburb"', () => {
    expect(cityLabel(false)).toBe('Suburb');
  });
});

describe('currencyCode', () => {
  it('US returns "USD"', () => {
    expect(currencyCode(true)).toBe('USD');
  });
  it('NZ returns "NZD"', () => {
    expect(currencyCode(false)).toBe('NZD');
  });
});

describe('currencySymbol', () => {
  it('US returns "$"', () => {
    expect(currencySymbol(true)).toBe('$');
  });
  it('NZ returns "NZ$"', () => {
    expect(currencySymbol(false)).toBe('NZ$');
  });
});
