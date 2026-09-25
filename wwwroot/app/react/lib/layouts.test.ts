import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CockpitLayout,
  DEFAULT_LAYOUT,
  deleteLayout,
  loadLayouts,
  saveLayouts,
  upsertLayout,
} from './layouts';

const KEY = 'RoutedOps_layouts';

function layout(name: string): CockpitLayout {
  return {
    name,
    horizontal: [25, 25, 25, 25],
    leftVertical: [33, 33, 34],
    runVertical: [50, 50],
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('DEFAULT_LAYOUT', () => {
  it('is named Default', () => {
    expect(DEFAULT_LAYOUT.name).toBe('Default');
  });

  it('horizontal percentages sum to 100', () => {
    const sum = DEFAULT_LAYOUT.horizontal.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('leftVertical percentages sum to 100', () => {
    const sum = DEFAULT_LAYOUT.leftVertical.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('runVertical percentages sum to 100', () => {
    const sum = DEFAULT_LAYOUT.runVertical.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('rvHorizontal percentages sum to 100', () => {
    const sum = (DEFAULT_LAYOUT.rvHorizontal ?? []).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});

describe('loadLayouts', () => {
  it('returns empty array when nothing is stored', () => {
    expect(loadLayouts()).toEqual([]);
  });

  it('returns parsed layouts from localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify([layout('Big map')]));
    const out = loadLayouts();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Big map');
  });

  it('returns empty array when stored value is not an array', () => {
    localStorage.setItem(KEY, JSON.stringify({ nope: true }));
    expect(loadLayouts()).toEqual([]);
  });

  it('returns empty array when stored JSON is corrupt', () => {
    localStorage.setItem(KEY, 'not json');
    expect(loadLayouts()).toEqual([]);
  });

  it('reads from the scoped key when scope is provided', () => {
    localStorage.setItem(KEY + '_RvHome', JSON.stringify([layout('Focus')]));
    const out = loadLayouts('home');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Focus');
  });

  it('scopes do not clobber each other', () => {
    localStorage.setItem(KEY, JSON.stringify([layout('Default scope')]));
    localStorage.setItem(KEY + '_RvHome', JSON.stringify([layout('Home scope')]));
    expect(loadLayouts('default')[0].name).toBe('Default scope');
    expect(loadLayouts('home')[0].name).toBe('Home scope');
  });
});

describe('saveLayouts', () => {
  it('writes layouts as JSON to the default key', () => {
    saveLayouts([layout('MyLayout')]);
    expect(localStorage.getItem(KEY)).toContain('"MyLayout"');
  });

  it('writes to the scoped key when scope is provided', () => {
    saveLayouts([layout('LinehaulOne')], 'linehaul');
    expect(localStorage.getItem(KEY + '_RvLinehaul')).toContain('"LinehaulOne"');
    expect(localStorage.getItem(KEY)).toBe(null);
  });
});

describe('upsertLayout', () => {
  it('appends when the name is not present', () => {
    const out = upsertLayout([layout('A')], layout('B'));
    expect(out.map((l) => l.name)).toEqual(['A', 'B']);
  });

  it('replaces the layout with the same name', () => {
    const existing = [layout('A'), layout('B')];
    const replacement: CockpitLayout = {
      name: 'A',
      horizontal: [50, 50, 0, 0],
      leftVertical: [100, 0, 0],
      runVertical: [50, 50],
    };
    const out = upsertLayout(existing, replacement);
    expect(out).toHaveLength(2);
    expect(out[0].horizontal).toEqual([50, 50, 0, 0]);
  });

  it('does not mutate the input array', () => {
    const existing = [layout('A')];
    upsertLayout(existing, layout('B'));
    expect(existing).toHaveLength(1);
  });
});

describe('deleteLayout', () => {
  it('removes the matching name', () => {
    const out = deleteLayout([layout('A'), layout('B')], 'A');
    expect(out.map((l) => l.name)).toEqual(['B']);
  });

  it('is a no-op when the name is not present', () => {
    const out = deleteLayout([layout('A')], 'Z');
    expect(out.map((l) => l.name)).toEqual(['A']);
  });
});
