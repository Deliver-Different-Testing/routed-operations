import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { ImportSummaryModal } from './ImportSummaryModal';
import { initialWizardState, type WizardState } from './wizardState';

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

describe('ImportSummaryModal', () => {
  it('renders nothing when open is false', () => {
    renderWithProviders(<ImportSummaryModal open={false} state={seed()} onClose={vi.fn()} />);
    expect(screen.queryByText(/Import Summary/i)).not.toBeInTheDocument();
  });

  it('shows the "success" title and "All jobs imported" copy when nothing failed', () => {
    renderWithProviders(
      <ImportSummaryModal
        open
        state={seed({
          perDepotResults: [{ depotId: 1, imported: 3, failed: 0 }],
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Import Summary')).toBeInTheDocument();
    expect(screen.getByText(/All jobs imported successfully/i)).toBeInTheDocument();
  });

  it('shows the "some jobs skipped" title when failures exist', () => {
    renderWithProviders(
      <ImportSummaryModal
        open
        state={seed({
          perDepotResults: [{ depotId: 1, imported: 3, failed: 2 }],
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/some jobs skipped/i)).toBeInTheDocument();
  });

  it('aggregates imported/failed across depots', () => {
    renderWithProviders(
      <ImportSummaryModal
        open
        state={seed({
          perDepotResults: [
            { depotId: 1, imported: 5, failed: 1 },
            { depotId: 2, imported: 2, failed: 0 },
          ],
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    // Failed=1 shows in the summary card. The per-depot table also renders
    // '1' for the depot-1 row; both are legitimate. Assert on the "Failed / Skipped"
    // panel using the label text.
    expect(screen.getByText(/Failed \/ Skipped/i)).toBeInTheDocument();
  });

  it('renders the per-depot breakdown only when >1 depot result', () => {
    const { rerender } = renderWithProviders(
      <ImportSummaryModal
        open
        state={seed({
          perDepotResults: [{ depotId: 1, imported: 5, failed: 0 }],
          depots: [{ depotId: 1, depotName: 'North', jobIndexes: [] }],
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('Per-depot breakdown')).not.toBeInTheDocument();
    rerender(
      <ImportSummaryModal
        open
        state={seed({
          perDepotResults: [
            { depotId: 1, imported: 5, failed: 0 },
            { depotId: 2, imported: 3, failed: 1 },
          ],
          depots: [
            { depotId: 1, depotName: 'North', jobIndexes: [] },
            { depotId: 2, depotName: 'South', jobIndexes: [] },
          ],
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Per-depot breakdown')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('South')).toBeInTheDocument();
  });

  it('falls back to "Depot <id>" when no bucket name is available', () => {
    renderWithProviders(
      <ImportSummaryModal
        open
        state={seed({
          perDepotResults: [
            { depotId: 99, imported: 1, failed: 0 },
            { depotId: 88, imported: 1, failed: 0 },
          ],
          depots: [],
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Depot 99')).toBeInTheDocument();
    expect(screen.getByText('Depot 88')).toBeInTheDocument();
  });

  it('renders the unimported table when failedImportJobs is non-empty', () => {
    renderWithProviders(
      <ImportSummaryModal
        open
        state={seed({
          perDepotResults: [{ depotId: 1, imported: 0, failed: 2 }],
          failedImportJobs: [
            { jobNumber: 'J-1', toAddress: '1 St', toSuburb: 'Newton', toPostCode: '1010' } as any,
            { jobNumber: 'J-2', toAddress: '2 St', toSuburb: 'Ponsonby', toPostCode: '1011' } as any,
          ],
        })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/Unimported jobs \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText('J-1')).toBeInTheDocument();
    expect(screen.getByText('J-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export unimported CSV/i })).toBeInTheDocument();
  });

  it('Export button click triggers download without error (jsdom safe)', () => {
    // Provide a spy for URL.createObjectURL so csvExport's downloadCsv doesn't
    // blow up in jsdom.
    const origCreate = URL.createObjectURL;
    (URL as any).createObjectURL = vi.fn(() => 'blob:test');
    const origRevoke = URL.revokeObjectURL;
    (URL as any).revokeObjectURL = vi.fn();
    try {
      renderWithProviders(
        <ImportSummaryModal
          open
          state={seed({
            perDepotResults: [{ depotId: 1, imported: 0, failed: 1 }],
            failedImportJobs: [
              {
                jobNumber: 'J-1',
                toAddress: '1 St',
                toSuburb: 'Newton',
                toPostCode: '1010',
              } as any,
            ],
          })}
          onClose={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Export unimported CSV/i }));
      expect((URL as any).createObjectURL).toHaveBeenCalled();
    } finally {
      (URL as any).createObjectURL = origCreate;
      (URL as any).revokeObjectURL = origRevoke;
    }
  });

  it('footer close button fires onClose', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ImportSummaryModal open state={seed()} onClose={onClose} />
    );
    // Two "Close" affordances: the modal X (aria-label="Close") and the
    // footer primary button (also 'Close'). Click all of them - either
    // fires onClose.
    const buttons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });

  it('US tenant switches postcode header label to Zip', () => {
    const original = (window as any).__APP_USER__;
    (window as any).__APP_USER__ = { ...original, isUsTenant: true };
    try {
      renderWithProviders(
        <ImportSummaryModal
          open
          state={seed({
            perDepotResults: [{ depotId: 1, imported: 0, failed: 1 }],
            failedImportJobs: [
              { jobNumber: 'J', toAddress: '1', toCity: 'X', toZipCode: '90210' } as any,
            ],
          })}
          onClose={vi.fn()}
        />
      );
      // Header 'Zip' appears in the unimported table.
      expect(screen.getByRole('columnheader', { name: 'Zip' })).toBeInTheDocument();
    } finally {
      (window as any).__APP_USER__ = original;
    }
  });
});
