import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The Driver Location List picker on a zone group. What persists is the
// tblClearListArea id, so the test pins that the operator picks by name and
// the id is what gets saved, and that an id with no matching list (deleted in
// Configurator) survives an unrelated save instead of being cleared.

const updateZoneGroup = vi.fn().mockResolvedValue({ response: {} });
const createZoneGroup = vi.fn().mockResolvedValue({ response: {} });
vi.mock('../../services/territoryService', async (orig) => ({
  ...(await orig<typeof import('../../services/territoryService')>()),
  territoryService: {
    updateZoneGroup: (...a: unknown[]) => updateZoneGroup(...a),
    createZoneGroup: (...a: unknown[]) => createZoneGroup(...a),
  },
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));

import { ZoneGroupEditModal } from './ZoneGroupsTab';

const areas = [
  { id: 2, code: 'MEL', name: 'Melbourne' },
  { id: 5, code: 'SYD', name: 'Sydney' },
];
const row = (clearListAreaId: number | null) => ({ id: 50, name: 'Metro', clearListAreaId, zoneNameCount: 3 });

describe('ZoneGroupEditModal driver location list picker', () => {
  beforeEach(() => { updateZoneGroup.mockClear(); createZoneGroup.mockClear(); });

  it('lists the driver location lists by code and name', () => {
    render(<ZoneGroupEditModal row={row(null)} areas={areas} onClose={() => {}} onSaved={() => {}} />);
    const select = screen.getByTestId('zg-clear-list-area') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['-', 'MEL - Melbourne', 'SYD - Sydney']);
    expect(select.value).toBe('');
  });

  it('saves the picked list as its id', async () => {
    render(<ZoneGroupEditModal row={row(2)} areas={areas} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId('zg-clear-list-area'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateZoneGroup).toHaveBeenCalledWith(50, { name: 'Metro', clearListAreaId: 5 }));
  });

  it('clearing the select saves no list', async () => {
    render(<ZoneGroupEditModal row={row(2)} areas={areas} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId('zg-clear-list-area'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateZoneGroup).toHaveBeenCalledWith(50, { name: 'Metro', clearListAreaId: null }));
  });

  it('keeps a saved id that is not in the list, shown as missing', async () => {
    render(<ZoneGroupEditModal row={row(99)} areas={areas} onClose={() => {}} onSaved={() => {}} />);
    const select = screen.getByTestId('zg-clear-list-area') as HTMLSelectElement;
    expect(select.value).toBe('99');
    expect(select.selectedOptions[0].text).toBe('#99 (missing)');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateZoneGroup).toHaveBeenCalledWith(50, { name: 'Metro', clearListAreaId: 99 }));
  });
});
