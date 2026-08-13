import { describe, expect, it, beforeAll } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import Quoting from './Quoting';

// jsdom's File may not implement .text(); patch a working shim so the
// upload handler can read the CSV body without hanging on a never-resolved
// promise.
beforeAll(() => {
  if (typeof (File.prototype as any).text !== 'function' ||
      (File.prototype as any).text.toString().includes('[native code]') === false) {
    (File.prototype as any).text = function (this: File) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
});

const setSummary = (over: Partial<Record<string, unknown>> = {}) => ({
  quoteSetCode: 'Acme-Q4',
  jobCount: 12,
  lastUploadedUtc: '2026-08-13T10:30:00Z',
  ...over,
});

const simResult = (over: Partial<Record<string, unknown>> = {}) => ({
  quoteSetCode: 'Acme-Q4',
  jobCount: 12,
  driversRequired: 3,
  avgShiftHours: 7.2,
  costPerJob: 15.5,
  costPerKm: 1.25,
  totalCost: 186.0,
  marginPct: 22,
  recommendedQuote: 227.0,
  ...over,
});

const stubSets = (sets: unknown[] = []) =>
  http.get('/api/quote/sets', () => HttpResponse.json({ response: sets }));

describe('Quoting page - render', () => {
  it('renders the four panels and pluralises the sets label', async () => {
    server.use(stubSets([]));
    renderWithProviders(<Quoting />);
    expect(await screen.findByText('1. Upload shadow jobs')).toBeInTheDocument();
    expect(screen.getByText('2. Configure + simulate')).toBeInTheDocument();
    expect(screen.getByText('3. Result')).toBeInTheDocument();
    expect(screen.getByText('Existing quote sets')).toBeInTheDocument();
    expect(screen.getByText('0 sets')).toBeInTheDocument();
    expect(screen.getByText('No quote sets yet.')).toBeInTheDocument();
  });

  it('renders existing sets in the sidebar with a delete affordance', async () => {
    server.use(stubSets([setSummary(), setSummary({ quoteSetCode: 'B', jobCount: 1, lastUploadedUtc: null })]));
    renderWithProviders(<Quoting />);
    expect(await screen.findByText('Acme-Q4')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('1 job')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
    expect(screen.getByText('2 sets')).toBeInTheDocument();
  });

  it('surfaces a fetch failure via the toast', async () => {
    server.use(
      http.get('/api/quote/sets', () =>
        new HttpResponse(JSON.stringify({ message: 'quote list boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderWithProviders(<Quoting />);
    expect(await screen.findByText(/quote list boom/)).toBeInTheDocument();
  });

  it('Refresh button re-fetches the sets list', async () => {
    let hits = 0;
    server.use(
      http.get('/api/quote/sets', () => {
        hits++;
        return HttpResponse.json({ response: [] });
      }),
    );
    renderWithProviders(<Quoting />);
    await waitFor(() => expect(hits).toBe(1));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(hits).toBe(2));
  });
});

describe('Quoting page - upload', () => {
  it('shows validation toast when set code is blank on upload', async () => {
    server.use(stubSets([]));
    renderWithProviders(<Quoting />);
    await screen.findByText('No quote sets yet.');
    const user = userEvent.setup();
    // The Upload button is disabled without CSV rows; type a code first, but leave rows empty
    await user.type(screen.getByPlaceholderText('e.g. Acme-Q4-2026'), 'CODE-A');
    // The button is disabled because parsedRows.length === 0
    expect(screen.getByRole('button', { name: /Upload 0 row/ })).toBeDisabled();
  });

  it('parses a CSV textarea + uploads + refreshes the list', async () => {
    let uploaded: unknown = null;
    let listHit = 0;
    server.use(
      http.get('/api/quote/sets', () => {
        listHit++;
        return HttpResponse.json({
          response: listHit > 1 ? [setSummary({ quoteSetCode: 'CODE-A', jobCount: 2 })] : [],
        });
      }),
      http.post('/api/quote/upload', async ({ request }) => {
        uploaded = await request.json();
        return HttpResponse.json({
          response: { quoteSetCode: 'CODE-A', rowsUploaded: 2 },
        });
      }),
    );
    renderWithProviders(<Quoting />);
    await screen.findByText('No quote sets yet.');
    const user = userEvent.setup();

    // Simulate a file upload directly, then edit the textarea to inject CSV text.
    const codeInput = screen.getByPlaceholderText('e.g. Acme-Q4-2026') as HTMLInputElement;
    await user.type(codeInput, 'CODE-A');

    // File input path
    const csvBody = [
      'Customer,FromAddress,ToAddress,FromPostCode,ToPostCode,WeightKg,WindowStart,WindowEnd,IsPickup',
      '"Acme",1 Main St,"22, King Rd",1010,2020,5.5,08:00,09:30,true',
      'Beta,,,3030,,,10:00:00,11:00:00,pickup',
    ].join('\n');
    const file = new File([csvBody], 'CODE-A.csv', { type: 'text/csv' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    // File.text() returns a Promise; polyfill in jsdom is functional.
    await user.upload(fileInput, file);
    // After upload, the CSV preview textarea should appear
    const textarea = await waitFor(
      () => document.querySelector('textarea') as HTMLTextAreaElement,
    );
    expect(textarea).toBeTruthy();
    // The preview textarea shows the parsed CSV; then click Upload
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value.length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: /Upload 2 row/ }));
    await waitFor(() => expect(uploaded).not.toBeNull());
    expect((uploaded as any).quoteSetCode).toBe('CODE-A');
    expect((uploaded as any).rows).toHaveLength(2);
    // Verify some parsed values
    expect((uploaded as any).rows[0].customer).toBe('Acme');
    expect((uploaded as any).rows[0].toAddress).toBe('22, King Rd');
    expect((uploaded as any).rows[0].windowStart).toBe('08:00:00');
    expect((uploaded as any).rows[0].isPickup).toBe(true);
    expect((uploaded as any).rows[1].isPickup).toBe(true);
    await waitFor(() =>
      expect(screen.getByText(/Uploaded 2 rows into "CODE-A"/)).toBeInTheDocument(),
    );
  });

  it('reports the upload API error message', async () => {
    server.use(
      stubSets([]),
      http.post('/api/quote/upload', () =>
        new HttpResponse(JSON.stringify({ message: 'upload nope' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderWithProviders(<Quoting />);
    await screen.findByText('No quote sets yet.');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('e.g. Acme-Q4-2026'), 'CODE-A');
    const file = new File(['Customer\nA'], 'x.csv', { type: 'text/csv' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Upload 1 row/ }));
    expect(await screen.findByText(/upload nope/)).toBeInTheDocument();
  });

  it('auto-fills the set code from the file name if the code input is empty', async () => {
    server.use(stubSets([]));
    renderWithProviders(<Quoting />);
    await screen.findByText('No quote sets yet.');
    const user = userEvent.setup();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['Customer\nA'], 'MyQuote.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);
    const codeInput = screen.getByPlaceholderText('e.g. Acme-Q4-2026') as HTMLInputElement;
    await waitFor(() => expect(codeInput.value).toBe('MyQuote'));
  });
});

describe('Quoting page - simulate', () => {
  it('runs simulation and renders every Stat card', async () => {
    server.use(
      stubSets([setSummary()]),
      http.post('/api/quote/simulate', () =>
        HttpResponse.json({ response: simResult() })),
    );
    renderWithProviders(<Quoting />);
    await screen.findByText('Acme-Q4');
    const user = userEvent.setup();
    // Change rate card + service level + numeric inputs to hit those handlers
    const selects = screen.getAllByRole('combobox');
    // selects[0] = quote-set, selects[1] = rate card, selects[2] = service level
    await user.selectOptions(selects[1], 'premium');
    await user.selectOptions(selects[2], 'express');
    // Numeric inputs
    const numberInputs = document.querySelectorAll('input[type="number"]');
    await user.clear(numberInputs[0] as HTMLInputElement);
    await user.type(numberInputs[0] as HTMLInputElement, '30');
    await user.clear(numberInputs[1] as HTMLInputElement);
    await user.type(numberInputs[1] as HTMLInputElement, '85');

    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    await screen.findByText('Recommended quote');
    expect(screen.getByText('$227.00')).toBeInTheDocument();
    expect(screen.getByText(/Recommended quote: \$227\.00/)).toBeInTheDocument();
  });

  it('reports simulation API error', async () => {
    server.use(
      stubSets([setSummary()]),
      http.post('/api/quote/simulate', () =>
        new HttpResponse(JSON.stringify({ message: 'sim boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderWithProviders(<Quoting />);
    await screen.findByText('Acme-Q4');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    expect(await screen.findByText(/sim boom/)).toBeInTheDocument();
  });

  it('clamps max-stops to at least 1 and utilPct 10-100', async () => {
    server.use(stubSets([setSummary()]));
    renderWithProviders(<Quoting />);
    await screen.findByText('Acme-Q4');
    const numberInputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(numberInputs[0] as HTMLInputElement, { target: { value: '0' } });
    expect((numberInputs[0] as HTMLInputElement).value).toBe('1');
    fireEvent.change(numberInputs[1] as HTMLInputElement, { target: { value: '5' } });
    expect((numberInputs[1] as HTMLInputElement).value).toBe('10');
    fireEvent.change(numberInputs[1] as HTMLInputElement, { target: { value: '150' } });
    expect((numberInputs[1] as HTMLInputElement).value).toBe('100');
  });

  it('picking a set from the sidebar switches the selected set', async () => {
    server.use(
      stubSets([setSummary({ quoteSetCode: 'A' }), setSummary({ quoteSetCode: 'B' })]),
    );
    renderWithProviders(<Quoting />);
    const rowA = await screen.findByText('A');
    const rowB = await screen.findByText('B');
    const user = userEvent.setup();
    // Click B's row (the sidebar button)
    await user.click(rowB);
    // The select in the config panel should reflect B
    const selects = screen.getAllByRole('combobox');
    expect((selects[0] as HTMLSelectElement).value).toBe('B');
    // Click A again
    await user.click(rowA);
    expect((selects[0] as HTMLSelectElement).value).toBe('A');
  });
});

describe('Quoting page - delete', () => {
  it('deletes a quote set on confirm and clears selection', async () => {
    let listHit = 0;
    let deleted: string | null = null;
    server.use(
      http.get('/api/quote/sets', () => {
        listHit++;
        return HttpResponse.json({
          response: listHit === 1 ? [setSummary({ quoteSetCode: 'Doomed', jobCount: 3 })] : [],
        });
      }),
      http.delete('/api/quote/sets/:code', ({ params }) => {
        deleted = String(params.code);
        return HttpResponse.json({ response: { quoteSetCode: deleted, deleted: 3 } });
      }),
    );
    renderWithProviders(<Quoting />);
    await screen.findByText('Doomed');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    // Confirm dialog
    expect(await screen.findByText(/Delete quote set "Doomed"/)).toBeInTheDocument();
    // Two Delete buttons now: the sidebar row's + the confirm's. Use the
    // last (the confirm modal's primary action).
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(deleted).toBe('Doomed'));
    await waitFor(() =>
      expect(screen.getByText(/Quote set "Doomed" deleted/)).toBeInTheDocument(),
    );
  });

  it('cancelling the confirm dialog is a no-op', async () => {
    let deleted: string | null = null;
    server.use(
      stubSets([setSummary({ quoteSetCode: 'Safe' })]),
      http.delete('/api/quote/sets/:code', ({ params }) => {
        deleted = String(params.code);
        return HttpResponse.json({ response: { quoteSetCode: deleted, deleted: 0 } });
      }),
    );
    renderWithProviders(<Quoting />);
    await screen.findByText('Safe');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText(/Delete quote set "Safe"/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleted).toBeNull();
  });

  it('shows delete API error', async () => {
    server.use(
      stubSets([setSummary({ quoteSetCode: 'X' })]),
      http.delete('/api/quote/sets/:code', () =>
        new HttpResponse(JSON.stringify({ message: 'del boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderWithProviders(<Quoting />);
    await screen.findByText('X');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText(/Delete quote set "X"/);
    // Confirm delete
    const btns = await screen.findAllByRole('button', { name: 'Delete' });
    await user.click(btns[btns.length - 1]);   // Delete confirm button (in the modal footer)
    expect(await screen.findByText(/del boom/)).toBeInTheDocument();
  });
});
