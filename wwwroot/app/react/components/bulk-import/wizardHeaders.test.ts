import { describe, expect, it, vi } from 'vitest';
import { buildJobs } from './NewImportWizard';
import {
  autoMatchColumn,
  initialWizardState,
  remapAfterTemplateClear,
  urgentFieldsFor,
  type WizardState,
} from './wizardState';

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: any) => children,
  Map: ({ children }: any) => children ?? null,
  AdvancedMarker: () => null,
  useMap: () => ({ setCenter: vi.fn(), setZoom: vi.fn() }),
  useMapsLibrary: () => ({}),
}));

// UC #881 header matching. The customer's file says "Ready Date" / "Ready Time"
// and names a Speed on every row, P2P or truck. Before this the date column
// needed a manual map, Speed only appeared once a truck speed was spotted, a
// P2P row's speed was never sent, and clearing a template left Speed unmapped.

const speeds = [
  { id: 3, name: 'Standard', code: 'STD', isTruck: false },
  { id: 52, name: 'Truck Economy', code: 'TECO', isTruck: true },
];

function nzOnDemand(rows: Record<string, string>[], overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState(),
    importType: 'onDemand',
    parsed: { headers: Object.keys(rows[0]), rows } as WizardState['parsed'],
    clientSettings: { speeds } as any,
    ...overrides,
  };
}

const keys = (isUs: boolean, type: 'onDemand' | 'routed') =>
  urgentFieldsFor(isUs, type, false, false, undefined, false, false).map((f) => f.key);

describe('header matching (#881)', () => {
  it('maps a Ready Date column to Book Date', () => {
    const field = urgentFieldsFor(false, 'onDemand', false).find((f) => f.key === 'bookDate')!;
    expect(autoMatchColumn(field, ['Job Number', 'Ready Date', 'Ready Time'])).toBe('Ready Date');
  });

  it('offers Speed on NZ on-demand with no truck speed in play, and nowhere else', () => {
    expect(keys(false, 'onDemand')).toContain('speed');
    expect(keys(false, 'onDemand')).not.toContain('palletType');
    expect(keys(true, 'onDemand')).not.toContain('speed');
    expect(keys(false, 'routed')).not.toContain('speed');
  });

  it('sends each NZ P2P row its own speed', () => {
    const state = nzOnDemand([{ Speed: 'Standard' }, { Speed: '' }], { mapping: { speed: 'Speed' } });
    expect(buildJobs(state, false).map((j) => j.speed)).toEqual(['Standard', undefined]);
  });

  it('never sends a row speed on a US tenant', () => {
    const state = nzOnDemand([{ Speed: 'Standard' }], { mapping: { speed: 'Speed' } });
    expect(buildJobs(state, true)[0].speed).toBeUndefined();
  });

  it('re-maps Speed and the truck fields when a template is cleared', () => {
    const state = nzOnDemand(
      [{ Service: 'TECO', 'Pallet Size': 'Std', 'Ready Date': '19/11/2026' }],
      { mapping: { speed: 'Custom', palletType: 'Custom2' }, options: { ...initialWizardState().options, templateId: 7 } }
    );
    const fieldsFor = (truck: boolean) => urgentFieldsFor(false, 'onDemand', false, false, undefined, false, truck);
    const mapping = remapAfterTemplateClear(state, false, fieldsFor);
    expect(mapping.speed).toBe('Service');
    expect(mapping.palletType).toBe('Pallet Size');
    expect(mapping.bookDate).toBe('Ready Date');
  });
});
