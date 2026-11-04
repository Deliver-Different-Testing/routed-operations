import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BulkTruckPreviewRow } from '../../services/bulkImportService';
import { TruckPreviewModal } from './TruckPreviewModal';
import { initialWizardState, truckPreviewTotals, wizardReducer, type WizardState } from './wizardState';

// The point of this step: an operator must be able to tell, before anything is
// written, what each truck row will cost and which rows will not make it.

const row = (patch: Partial<BulkTruckPreviewRow>): BulkTruckPreviewRow => ({
  rowIndex: 0,
  jobNumber: 'T1',
  speedName: 'Truck Economy',
  fromSuburb: 'Otahuhu',
  toSuburb: 'Onehunga',
  quantity: 2,
  rate: 41.5,
  fuel: 3.5,
  amount: 45,
  ratedManually: false,
  wouldImport: true,
  reason: null,
  warning: null,
  ...patch,
});

const preview = (rows: BulkTruckPreviewRow[], otherRowCount = 0) => ({
  messageId: 'x', success: true, messages: [], rows, otherRowCount,
});

const refused = (rowIndex: number, reason: string) =>
  row({ rowIndex, jobNumber: `R${rowIndex}`, rate: null, fuel: null, amount: null, wouldImport: false, reason });

function renderModal(state: Partial<WizardState>, onImport = vi.fn()) {
  render(
    <TruckPreviewModal
      open
      state={{ ...initialWizardState(), ...state }}
      onBack={vi.fn()}
      onImport={onImport}
      onCancel={vi.fn()}
      importing={false}
    />
  );
  return onImport;
}

describe('truckPreviewTotals', () => {
  it('leaves refused rows out of the total and out of the import count', () => {
    const totals = truckPreviewTotals(preview([row({ amount: 45 }), row({ rowIndex: 1, amount: 55 }), refused(2, 'No truck rate')], 3));
    expect(totals).toEqual({ wouldImport: 2, wouldReject: 1, totalPrice: 100, importCount: 5 });
  });

  it('is all zeros before a preview has loaded', () => {
    expect(truckPreviewTotals(null)).toEqual({ wouldImport: 0, wouldReject: 0, totalPrice: 0, importCount: 0 });
  });
});

describe('wizard state', () => {
  // A price worked out for one depot must never sit in front of the next one.
  it('drops the preview when the cursor moves to another depot', () => {
    const loaded = wizardReducer(initialWizardState(), { type: 'SET_TRUCK_PREVIEW', preview: preview([row({})]) });
    expect(loaded.truckPreview).not.toBeNull();
    expect(wizardReducer(loaded, { type: 'SET_CURRENT_DEPOT', index: 1 }).truckPreview).toBeNull();
    expect(wizardReducer(loaded, { type: 'START_PENDING_DEPOT' }).truckPreview).toBeNull();
  });
});

describe('TruckPreviewModal', () => {
  it('flags only the refused row, with its reason and no price', () => {
    renderModal({ truckPreview: preview([row({}), refused(1, 'No truck rate for speed 52.')]) });

    const [good, bad] = screen.getAllByTestId('truck-preview-row');
    expect(good).not.toHaveAttribute('data-rejected');
    expect(good.className).not.toContain('bg-warning');
    expect(bad).toHaveAttribute('data-rejected', 'true');
    expect(bad.className).toContain('bg-warning');
    expect(within(bad).getByTestId('truck-preview-reason')).toHaveTextContent('No truck rate for speed 52.');
    expect(within(bad).getByTestId('truck-preview-price').textContent).toBe('');
    expect(screen.getByTestId('truck-preview-rejected-count')).toHaveTextContent('1');
  });

  it('marks a staff amount as rated manually', () => {
    renderModal({ truckPreview: preview([row({ rate: null, fuel: null, amount: 88, ratedManually: true })]) });
    const price = screen.getByTestId('truck-preview-price');
    expect(price.textContent).toContain('88');
    expect(within(price).getByTestId('truck-preview-manual')).toHaveTextContent('Rated manually');
  });

  it('shows a warning without flagging a row that will still import', () => {
    renderModal({ truckPreview: preview([row({ warning: "Delivery suburb 'Nowhere' was not recognised." })]) });
    expect(screen.getByTestId('truck-preview-row')).not.toHaveAttribute('data-rejected');
    expect(screen.getByTestId('truck-preview-reason')).toHaveTextContent('not recognised');
  });

  it('counts the P2P rows on the Import button and says they price at import', () => {
    const onImport = renderModal({ truckPreview: preview([row({}), refused(1, 'No rate')], 2) });
    expect(screen.getByTestId('truck-preview-other')).toHaveTextContent('2 other jobs are not on a truck speed');
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 jobs' }));
    expect(onImport).toHaveBeenCalledOnce();
  });

  it('keeps an import failure on screen', () => {
    renderModal({ truckPreview: preview([row({})]), importError: 'Book date must be in the future.' });
    expect(screen.getByTestId('truck-preview-import-error')).toHaveTextContent('Book date must be in the future.');
  });
});
