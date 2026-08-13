import { describe, expect, it } from 'vitest';
import { windowsToIana } from './timezone';

describe('windowsToIana', () => {
  it('maps New Zealand Standard Time to Pacific/Auckland', () => {
    expect(windowsToIana('New Zealand Standard Time')).toBe('Pacific/Auckland');
  });

  it('maps Pacific Standard Time to America/Los_Angeles', () => {
    expect(windowsToIana('Pacific Standard Time')).toBe('America/Los_Angeles');
  });

  it('maps UTC to UTC', () => {
    expect(windowsToIana('UTC')).toBe('UTC');
  });

  it('maps Coordinated Universal Time to UTC', () => {
    expect(windowsToIana('Coordinated Universal Time')).toBe('UTC');
  });

  it('maps Eastern Standard Time to America/New_York', () => {
    expect(windowsToIana('Eastern Standard Time')).toBe('America/New_York');
  });

  it('maps AUS Eastern Standard Time to Australia/Sydney', () => {
    expect(windowsToIana('AUS Eastern Standard Time')).toBe('Australia/Sydney');
  });

  it('maps GMT Standard Time to Europe/London', () => {
    expect(windowsToIana('GMT Standard Time')).toBe('Europe/London');
  });

  it('returns the input unchanged when not in the map', () => {
    expect(windowsToIana('Some Unknown Zone')).toBe('Some Unknown Zone');
  });

  it('returns empty string when passed empty string', () => {
    expect(windowsToIana('')).toBe('');
  });
});
