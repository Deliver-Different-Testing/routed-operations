import { describe, expect, it } from 'vitest';
import { regionFilterOptions } from './regionOptions';

// Steve 2026-11-27: Cheetah's Phoenix (30) and Las Vegas (31) depots went
// inactive on 12 Nov but still showed in the Route Viewer Region filter
// with "Active regions only" ticked.
const regions = [
  { id: 10, label: 'Dallas', active: true },
  { id: 30, label: 'Phoenix', active: false },
  { id: 31, label: 'Las Vegas', active: false },
  { id: 40, label: 'Legacy row' }, // no flag
];

const labels = (o: { label: string }[]) => o.map((x) => x.label);

describe('regionFilterOptions', () => {
  it('active only: hides inactive regions so operators cannot pick a closed depot', () => {
    expect(labels(regionFilterOptions(regions, true, null))).toEqual(['Dallas', 'Legacy row']);
  });

  it('active only: keeps an already-selected inactive region, marked, so a stored selection still shows', () => {
    const opts = regionFilterOptions(regions, true, 30);
    expect(opts).toEqual([
      { value: '10', label: 'Dallas' },
      { value: '30', label: 'Phoenix (inactive)' },
      { value: '40', label: 'Legacy row' },
    ]);
  });

  it('box unticked: shows every region, inactive ones marked', () => {
    expect(labels(regionFilterOptions(regions, false, null))).toEqual([
      'Dallas', 'Phoenix (inactive)', 'Las Vegas (inactive)', 'Legacy row',
    ]);
  });

  it('missing active flag counts as active (never hidden, never marked)', () => {
    expect(regionFilterOptions([{ id: 40, label: 'Legacy row' }], true, null))
      .toEqual([{ value: '40', label: 'Legacy row' }]);
  });
});
