import { describe, expect, it } from 'vitest';
import { configuratorOrigin, depotSettingsUrl, driverLocationListUrl } from './settingsLinks';

// The link is only worth rendering where a Configurator actually sits next to
// this app. A link built from localhost or the .local. dev host points at
// nothing, so the helper must say "no link" there rather than guess.
describe('settingsLinks', () => {
  it('prod: swaps the first host label to the Configurator', () => {
    expect(configuratorOrigin('https://routedoperations.medical.deliverdifferent.com'))
      .toBe('https://dfrntdriveconfig.medical.deliverdifferent.com');
    expect(driverLocationListUrl(12, 'https://routedoperations.medical.deliverdifferent.com'))
      .toBe('https://dfrntdriveconfig.medical.deliverdifferent.com/settings/driver-locations/12');
  });

  it('staging: keeps the rest of the host, including .staging.', () => {
    expect(depotSettingsUrl(35, 'https://routedoperations.crisis.staging.deliverdifferent.com'))
      .toBe('https://dfrntdriveconfig.crisis.staging.deliverdifferent.com/settings/locations/35');
  });

  it('localhost: no link', () => {
    expect(configuratorOrigin('http://localhost:5173')).toBeNull();
    expect(driverLocationListUrl(1, 'http://localhost:5173')).toBeNull();
    expect(depotSettingsUrl(1, 'http://localhost:5173')).toBeNull();
  });

  it('local dev host: no link', () => {
    expect(configuratorOrigin('https://routedoperations.local.deliverdifferent.com:65243')).toBeNull();
  });

  it('a host that only contains the prefix later on: no link', () => {
    expect(configuratorOrigin('https://app.routedoperations.example.com')).toBeNull();
  });
});
