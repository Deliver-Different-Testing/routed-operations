import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { BookPickupModal } from './BookPickupModal';
import { initialWizardState, type WizardState } from './wizardState';

function seed(state?: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...state };
}

const payload = {
  vehicleSizes: [{ label: 'Small', value: 'SM' }, { label: 'Large', value: 'LG' }],
  numberOfVehicles: [{ label: '1', value: '1' }, { label: '2', value: '2' }],
  pickupJob: {
    clientID: 1,
    time: '2026-01-01T10:00',
    weight: '20',
    quantity: 3,
    toPostCode: 1010,
  } as any,
};

describe('BookPickupModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when open is false', () => {
    renderWithProviders(
      <BookPickupModal
        open={false}
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    expect(screen.queryByText(/Book Pickup/)).not.toBeInTheDocument();
  });

  it('shows "No pickup data available" when payload absent', () => {
    renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: null })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    expect(screen.getByText(/No pickup data available/)).toBeInTheDocument();
  });

  it('hydrates dropdown defaults and text inputs from the payload seed', () => {
    const { container } = renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    const selects = container.querySelectorAll('select');
    expect(selects[0]).toHaveValue('SM');
    expect(selects[1]).toHaveValue('1');
    const inputs = container.querySelectorAll('input[type="number"]');
    expect(inputs[0]).toHaveValue(20);
    expect(inputs[1]).toHaveValue(3);
  });

  it('debounced rate fetch updates the estimated rate', async () => {
    server.use(
      http.post('/api/bulk-import/pickup-rate', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [],
          amount: 42.5,
        })
      )
    );
    renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    // Advance past 500ms debounce.
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(screen.getByText(/\$42\.50|NZ\$42\.50|\$42\.50/)).toBeInTheDocument());
  });

  it('primary Book pickup fires the /book-pickup POST and shows success confirmation', async () => {
    server.use(
      http.post('/api/bulk-import/pickup-rate', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], amount: 10 })
      ),
      http.post('/api/bulk-import/book-pickup', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [],
          jobId: [111, 222],
        })
      )
    );
    renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    // Wait for state.pickupTime hydration; then click Book pickup.
    const bookBtn = await screen.findByRole('button', { name: 'Book pickup' });
    fireEvent.click(bookBtn);
    // Two "Pickup booked" strings appear (toast + confirmation panel).
    await waitFor(() => {
      const els = screen.getAllByText(/Pickup booked/);
      expect(els.length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/111, 222/)).toBeInTheDocument();
  });

  it('shows an error message when book-pickup returns success=false', async () => {
    server.use(
      http.post('/api/bulk-import/pickup-rate', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], amount: 10 })
      ),
      http.post('/api/bulk-import/book-pickup', () =>
        HttpResponse.json({
          messageId: 'x',
          success: false,
          messages: [{ message: 'no can do' }],
          jobId: [],
        })
      )
    );
    renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Book pickup' }));
    await waitFor(() => expect(screen.getByText(/no can do/)).toBeInTheDocument());
  });

  it('rate fetch reports error string when server 500s', async () => {
    server.use(
      http.post('/api/bulk-import/pickup-rate', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    );
    renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it('changing Vehicle Size and Number of Vehicles updates the UI', () => {
    const { container } = renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'LG' } });
    expect(selects[0]).toHaveValue('LG');
    fireEvent.change(selects[1], { target: { value: '2' } });
    expect(selects[1]).toHaveValue('2');
  });

  it('changing Weight and Quantity persists via controlled input', () => {
    const { container } = renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={vi.fn()}
      />
    );
    const numberInputs = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numberInputs[0], { target: { value: '99' } });
    expect(numberInputs[0]).toHaveValue(99);
    fireEvent.change(numberInputs[1], { target: { value: '5' } });
    expect(numberInputs[1]).toHaveValue(5);
  });

  it('"No pickup required" button fires onClose', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={onClose}
        onBooked={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /No pickup required/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Finish button after booking fires onBooked', async () => {
    server.use(
      http.post('/api/bulk-import/pickup-rate', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], amount: 10 })
      ),
      http.post('/api/bulk-import/book-pickup', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [],
          jobId: [1],
        })
      )
    );
    const onBooked = vi.fn();
    renderWithProviders(
      <BookPickupModal
        open
        state={seed({ pickupJobPayload: payload })}
        onClose={vi.fn()}
        onBooked={onBooked}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Book pickup' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onBooked).toHaveBeenCalled();
  });
});
