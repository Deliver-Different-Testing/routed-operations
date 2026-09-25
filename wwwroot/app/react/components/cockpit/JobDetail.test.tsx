import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { JobDetail } from './JobDetail';
import type { BulkJob, Speed } from '@/types';

function makeJob(over: Partial<BulkJob> = {}): BulkJob {
  return {
    bulkJobId: 55,
    jobNumber: 'JOB-55',
    bookDate: '2026-08-13',
    bookTime: '2026-08-13T09:30:00',
    jobStatus: 0,
    clientId: 100,
    clientCode: 'ACME',
    amount: 42,
    speed: 10,
    speedName: 'Same Day',
    fromCompany: 'Sender Co',
    fromAddress: '1 Sender St',
    fromSuburb: 'CBD',
    fromPostCode: 1010,
    toCompany: 'Receiver Co',
    toAddress: '99 Recipient Rd',
    toSuburb: 'Ponsonby',
    toPostCode: 1011,
    size: 1,
    qty: 2,
    weight: 3,
    courierId: null,
    courierName: 'Alice',
    clientRefa: 'REF-A',
    clientRefb: 'REF-B',
    ourRef: 'US-1',
    notes: 'Existing notes',
    pickUpLatitude: '-36.85',
    pickUpLongitude: '174.76',
    deliveryLatitude: '-36.86',
    deliveryLongitude: '174.77',
    prebookJob: false,
    onHold: false,
    void: false,
    done: false,
    bulkRunId: null,
    runName: null,
    runOrder: null,
    multiboxParentId: null,
    parentId: null,
    regionId: null,
    barcode: 'BC-1',
    okToLeave: false,
    contact: 'Bob',
    deliverToContact: 'Chris',
    deliverToPhone: '555',
    trackingEmail: 'test@example.com',
    trackingMobile: '021',
    proofOfDeliveryEmail: 'pod@example.com',
    proofOfDeliveryMobile: '022',
    scheduleId: null,
    scheduleName: 'Morning',
    scheduleWindowStart: '2026-08-13T09:00:00Z',
    scheduleWindowEnd: '2026-08-13T11:00:00Z',
    jobCubicM3: 0.5,
    maxJobsPerRun: null,
    applyPickupCutoff: null,
    pickupCutoffHours: null,
    prefixRunName: null,
    postCodeMergeTo: null,
    runSequence: 0,
    bulkJobRunId: 0,
    ...over,
  };
}

const speeds: Speed[] = [
  { id: 10, label: 'Same Day' },
  { id: 11, label: 'Overnight' },
];

beforeEach(() => {
  // The JobDetail useEffect fetches /api/jobs/{id}/detail on mount to lazy-load
  // notes + tracking + POD extras. Stub with an empty response so MSW doesn't
  // complain about unhandled requests.
  server.use(
    http.get('/api/jobs/:id/detail', () =>
      HttpResponse.json({
        bulkJobId: 55,
        notes: null,
        trackingEmail: null,
        trackingMobile: null,
        proofOfDeliveryEmail: null,
        proofOfDeliveryMobile: null,
      })
    ),
  );
});

describe('JobDetail', () => {
  it('shows the empty placeholder when no job is selected', () => {
    renderWithProviders(
      <JobDetail job={null} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    expect(screen.getByText(/Select a job to see its details/)).toBeInTheDocument();
  });

  it('renders the header with the job number', () => {
    const job = makeJob();
    renderWithProviders(
      <JobDetail job={job} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    expect(screen.getByText(/Detail for Job JOB-55/)).toBeInTheDocument();
  });

  it('shows metric tiles including run + schedule + cubic', () => {
    const job = makeJob();
    renderWithProviders(
      <JobDetail job={job} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    // "Run" appears twice (metric tile + info card row label); use getAllByText.
    expect(screen.getAllByText('Run').length).toBeGreaterThan(0);
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('0.500 m3')).toBeInTheDocument();
  });

  it('renders the Fix GPS button when onOpenGpsFix is wired and clicking fires it', () => {
    const onOpenGpsFix = vi.fn();
    const job = makeJob();
    renderWithProviders(
      <JobDetail
        job={job}
        speeds={speeds}
        onUpdateField={vi.fn(async () => {})}
        onOpenGpsFix={onOpenGpsFix}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix GPS' }));
    expect(onOpenGpsFix).toHaveBeenCalledWith(job);
  });

  it('does NOT render Fix GPS button when onOpenGpsFix is undefined', () => {
    renderWithProviders(
      <JobDetail job={makeJob()} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    expect(screen.queryByRole('button', { name: 'Fix GPS' })).not.toBeInTheDocument();
  });

  it('renders pickup + delivery address cards', () => {
    renderWithProviders(
      <JobDetail job={makeJob()} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    // Company / recipient labels.
    expect(screen.getByText('Recipient')).toBeInTheDocument();
  });

  it('renders GPS "missing" style when coords are absent', () => {
    const job = makeJob({ pickUpLatitude: null, deliveryLatitude: null });
    renderWithProviders(
      <JobDetail job={job} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    const missing = screen.getAllByText('missing');
    expect(missing.length).toBe(2);
  });

  it('editable cell click switches to input then commits on blur', async () => {
    const onUpdateField = vi.fn(async () => {});
    renderWithProviders(
      <JobDetail job={makeJob()} speeds={speeds} onUpdateField={onUpdateField} />
    );
    // Amount = 42 -> click to edit.
    const amount = screen.getByText('42');
    fireEvent.click(amount);
    const input = screen.getByDisplayValue('42') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onUpdateField).toHaveBeenCalledWith(55, 'Amount', '55'));
  });

  it('escape cancels an active edit without calling onUpdateField', () => {
    const onUpdateField = vi.fn(async () => {});
    renderWithProviders(
      <JobDetail job={makeJob()} speeds={speeds} onUpdateField={onUpdateField} />
    );
    const amount = screen.getByText('42');
    fireEvent.click(amount);
    const input = screen.getByDisplayValue('42') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '77' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onUpdateField).not.toHaveBeenCalled();
  });

  it('changing speed select calls onUpdateField with the new value', async () => {
    const onUpdateField = vi.fn(async () => {});
    renderWithProviders(
      <JobDetail job={makeJob()} speeds={speeds} onUpdateField={onUpdateField} />
    );
    // The speed select uses value=String(speed) so we can hunt by value.
    const select = screen.getByDisplayValue('Same Day') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '11' } });
    await waitFor(() => expect(onUpdateField).toHaveBeenCalledWith(55, 'Speed', '11'));
  });

  it('right-click on pickup address opens the address menu with Update GPS', () => {
    const onOpenGpsFix = vi.fn();
    renderWithProviders(
      <JobDetail
        job={makeJob()}
        speeds={speeds}
        onUpdateField={vi.fn(async () => {})}
        onOpenGpsFix={onOpenGpsFix}
      />
    );
    // The whole "Pickup" card is wrapped in an onContextMenu handler on the
    // outer div; right-click on the address block or its header opens the menu.
    fireEvent.contextMenu(screen.getByText('Pickup'));
    expect(screen.getByText('Pickup address')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update GPS...' }));
    expect(onOpenGpsFix).toHaveBeenCalled();
  });

  it('formats pickup window with 24h HH:MM range', () => {
    renderWithProviders(
      <JobDetail job={makeJob()} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    // scheduleWindowStart=09:00 -> 11:00 in UTC.
    expect(screen.getByText('09:00 - 11:00')).toBeInTheDocument();
  });

  it('toggles Sig not req checkbox and calls onUpdateField', async () => {
    const onUpdateField = vi.fn(async () => {});
    renderWithProviders(
      <JobDetail job={makeJob()} speeds={speeds} onUpdateField={onUpdateField} />
    );
    // Sig not req -> the checkbox labelled "No" (since okToLeave false).
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(cb);
    await waitFor(() => expect(onUpdateField).toHaveBeenCalledWith(55, 'OkToLeave', 'true'));
  });

  it('lazy-fetches detail extras and merges notes into the job body', async () => {
    server.use(
      http.get('/api/jobs/:id/detail', () =>
        HttpResponse.json({
          bulkJobId: 55,
          notes: 'Extra notes',
          trackingEmail: 'lazy@example.com',
          trackingMobile: null,
          proofOfDeliveryEmail: null,
          proofOfDeliveryMobile: null,
        })
      ),
    );
    const job = makeJob({ notes: null });
    renderWithProviders(
      <JobDetail job={job} speeds={speeds} onUpdateField={vi.fn(async () => {})} />
    );
    await waitFor(() => expect(screen.getAllByText('Extra notes').length).toBeGreaterThan(0));
  });
});
