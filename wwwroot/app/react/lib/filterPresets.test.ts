import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FilterPreset,
  deleteFilterPreset,
  loadFilterPresets,
  saveFilterPresets,
  upsertFilterPreset,
} from './filterPresets';

const KEY = 'RoutedOps_filterPresets';

function preset(name: string): FilterPreset {
  return {
    name,
    filters: { date: '2026-08-13', clientIds: [], regionIds: [], ourRefs: [], speeds: [] },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('loadFilterPresets', () => {
  it('returns empty array when nothing is stored', () => {
    expect(loadFilterPresets()).toEqual([]);
  });

  it('returns parsed presets from localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify([preset('A'), preset('B')]));
    const out = loadFilterPresets();
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('A');
  });

  it('returns empty array when stored value is not an array', () => {
    localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadFilterPresets()).toEqual([]);
  });

  it('returns empty array when stored value is invalid JSON', () => {
    localStorage.setItem(KEY, '{{{ broken');
    expect(loadFilterPresets()).toEqual([]);
  });
});

describe('saveFilterPresets', () => {
  it('writes the presets as JSON', () => {
    saveFilterPresets([preset('X')]);
    const raw = localStorage.getItem(KEY);
    expect(raw).toContain('"X"');
  });

  it('overwrites previous saved value', () => {
    saveFilterPresets([preset('First')]);
    saveFilterPresets([preset('Second')]);
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    expect(raw).toHaveLength(1);
    expect(raw[0].name).toBe('Second');
  });
});

describe('upsertFilterPreset', () => {
  it('appends when the name is not present', () => {
    const out = upsertFilterPreset([preset('A')], preset('B'));
    expect(out.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('replaces the preset with the same name', () => {
    const existing = [preset('A'), preset('B')];
    const next: FilterPreset = {
      name: 'A',
      filters: { date: '2027-01-01', clientIds: [1], regionIds: [], ourRefs: [], speeds: [] },
    };
    const out = upsertFilterPreset(existing, next);
    expect(out).toHaveLength(2);
    expect(out[0].filters.date).toBe('2027-01-01');
    expect(out[0].filters.clientIds).toEqual([1]);
  });

  it('does not mutate the input array', () => {
    const existing = [preset('A')];
    upsertFilterPreset(existing, preset('B'));
    expect(existing).toHaveLength(1);
  });
});

describe('deleteFilterPreset', () => {
  it('removes the matching name', () => {
    const out = deleteFilterPreset([preset('A'), preset('B')], 'A');
    expect(out.map((p) => p.name)).toEqual(['B']);
  });

  it('is a no-op when the name is not present', () => {
    const out = deleteFilterPreset([preset('A')], 'Z');
    expect(out.map((p) => p.name)).toEqual(['A']);
  });

  it('does not mutate the input array', () => {
    const existing = [preset('A')];
    deleteFilterPreset(existing, 'A');
    expect(existing).toHaveLength(1);
  });
});
