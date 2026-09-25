import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { KmRatedReviewModal } from './KmRatedReviewModal';
import { initialWizardState, type WizardState } from './wizardState';

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

const kmRow = (i: number) =>
  ({
    jobNumber: `J-${i}`,
    toAddress: `${i} High St`,
    toSuburb: 'Newton',
    toPostCode: '1010',
    toCity: 'Boston',
    toZipCode: '02110',
    amount: 12.34,
    errorMessage: null,
  }) as any;

describe('KmRatedReviewModal', () => {
  const noop = vi.fn();

  it('renders nothing when open=false', () => {
    renderWithProviders(
      <KmRatedReviewModal
        open={false}
        state={seed()}
        dispatch={noop}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={noop}
        importing={false}
      />
    );
    expect(screen.queryByText(/Confirm km-rated jobs/)).not.toBeInTheDocument();
  });

  it('renders the header, table headers and empty-body notice when there are no rows', () => {
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: [], kmRatedSelected: new Set() })}
        dispatch={noop}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={noop}
        importing={false}
      />
    );
    expect(screen.getByText(/Confirm km-rated jobs/)).toBeInTheDocument();
    expect(screen.getByText(/No km-rated rows to review/)).toBeInTheDocument();
  });

  it('lists every row and initially selected count matches selection set size', () => {
    const rows = [kmRow(1), kmRow(2)];
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: rows, kmRatedSelected: new Set([0, 1]) })}
        dispatch={noop}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={noop}
        importing={false}
      />
    );
    expect(screen.getByText('J-1')).toBeInTheDocument();
    expect(screen.getByText('J-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload selected \(2\)/ })).toBeInTheDocument();
  });

  it('toggle-all fires SET_ALL_KMRATED_SELECTED with the inverse selected state', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: [kmRow(1)], kmRatedSelected: new Set([0]) })}
        dispatch={dispatch}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={noop}
        importing={false}
      />
    );
    fireEvent.click(screen.getByLabelText('Toggle all'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ALL_KMRATED_SELECTED', selected: false });
  });

  it('per-row checkbox toggle dispatches TOGGLE_KMRATED_ROW', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: [kmRow(1), kmRow(2)], kmRatedSelected: new Set([0, 1]) })}
        dispatch={dispatch}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={noop}
        importing={false}
      />
    );
    // Row checkboxes: index 0 is the toggle-all, 1+ are per-row.
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_KMRATED_ROW', index: 0 });
  });

  it('Upload selected calls onUploadSelected with the deselected rows', () => {
    const rows = [kmRow(1), kmRow(2), kmRow(3)];
    const onUploadSelected = vi.fn();
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: rows, kmRatedSelected: new Set([0]) })}
        dispatch={noop}
        onUploadSelected={onUploadSelected}
        onSkip={noop}
        onCancel={noop}
        importing={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Upload selected/ }));
    expect(onUploadSelected).toHaveBeenCalledTimes(1);
    // Rows 1 and 2 (index 1 and 2) are deselected.
    const deselected = onUploadSelected.mock.calls[0][0];
    expect(deselected).toHaveLength(2);
    expect(deselected[0].jobNumber).toBe('J-2');
    expect(deselected[1].jobNumber).toBe('J-3');
  });

  it('Skip km-rated button calls onSkip', () => {
    const onSkip = vi.fn();
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: [kmRow(1)], kmRatedSelected: new Set([0]) })}
        dispatch={noop}
        onUploadSelected={noop}
        onSkip={onSkip}
        onCancel={noop}
        importing={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Skip km-rated/ }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('Cancel button fires onCancel', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed()}
        dispatch={noop}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={onCancel}
        importing={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Upload button is disabled when no rows are selected', () => {
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: [kmRow(1)], kmRatedSelected: new Set() })}
        dispatch={noop}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={noop}
        importing={false}
      />
    );
    expect(screen.getByRole('button', { name: /Upload selected \(0\)/ })).toBeDisabled();
  });

  it('shows Uploading... label when importing=true', () => {
    renderWithProviders(
      <KmRatedReviewModal
        open
        state={seed({ kmRatedRows: [kmRow(1)], kmRatedSelected: new Set([0]) })}
        dispatch={noop}
        onUploadSelected={noop}
        onSkip={noop}
        onCancel={noop}
        importing
      />
    );
    expect(screen.getByRole('button', { name: 'Uploading...' })).toBeDisabled();
  });

  it('Export CSV button triggers download when rows present', () => {
    const originalCreate = URL.createObjectURL;
    (URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = vi.fn();
    try {
      renderWithProviders(
        <KmRatedReviewModal
          open
          state={seed({ kmRatedRows: [kmRow(1)], kmRatedSelected: new Set([0]) })}
          dispatch={noop}
          onUploadSelected={noop}
          onSkip={noop}
          onCancel={noop}
          importing={false}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
      expect((URL as any).createObjectURL).toHaveBeenCalled();
    } finally {
      (URL as any).createObjectURL = originalCreate;
    }
  });
});
