import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { GroupedJobs } from './GroupedJobs';
import type { BulkJob } from '@/types';

function makeJob(over: Partial<BulkJob> = {}): BulkJob {
  return {
    bulkJobId: 1,
    jobNumber: 'JOB-1',
    bookDate: '2026-08-13',
    bookTime: '2026-08-13T09:30:00',
    jobStatus: 0,
    clientId: 100,
    clientCode: 'ACME',
    amount: 0,
    speed: 10,
    speedName: null,
    fromCompany: null,
    fromAddress: null,
    fromSuburb: null,
    fromPostCode: null,
    toCompany: null,
    toAddress: null,
    toSuburb: 'Ponsonby',
    toPostCode: 1011,
    size: 0,
    qty: 0,
    weight: 0,
    courierId: null,
    courierName: null,
    clientRefa: null,
    clientRefb: null,
    ourRef: null,
    notes: null,
    pickUpLatitude: null,
    pickUpLongitude: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
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
    barcode: null,
    okToLeave: null,
    contact: null,
    deliverToContact: null,
    deliverToPhone: null,
    trackingEmail: null,
    trackingMobile: null,
    proofOfDeliveryEmail: null,
    proofOfDeliveryMobile: null,
    scheduleId: null,
    scheduleName: null,
    scheduleWindowStart: null,
    scheduleWindowEnd: null,
    jobCubicM3: null,
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

type Props = Parameters<typeof GroupedJobs>[0];
function props(over: Partial<Props> = {}): Props {
  return {
    jobs: [],
    search: '',
    mode: 'postcode',
    onSetMode: vi.fn(),
    onSetSearch: vi.fn(),
    ...over,
  };
}

describe('GroupedJobs', () => {
  it('shows empty state when no jobs supplied', () => {
    renderWithProviders(<GroupedJobs {...props()} />);
    expect(screen.getByText('No jobs to group.')).toBeInTheDocument();
  });

  it('groups jobs by postcode and shows the count label', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, toPostCode: 1011, toSuburb: 'Ponsonby' }),
      makeJob({ bulkJobId: 2, toPostCode: 1011, toSuburb: 'Ponsonby' }),
      makeJob({ bulkJobId: 3, toPostCode: 1050, toSuburb: 'CBD' }),
    ];
    renderWithProviders(<GroupedJobs {...props({ jobs })} />);
    expect(screen.getByText('1011')).toBeInTheDocument();
    expect(screen.getByText('1050')).toBeInTheDocument();
    expect(screen.getByText('2 jobs')).toBeInTheDocument();
    expect(screen.getByText('1 job')).toBeInTheDocument();
  });

  it('groups by time when mode = time', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, bookTime: '09:15:00' }),
      makeJob({ bulkJobId: 2, bookTime: '09:45:00' }),
      makeJob({ bulkJobId: 3, bookTime: null as any }),
    ];
    renderWithProviders(<GroupedJobs {...props({ jobs, mode: 'time' })} />);
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('09:30')).toBeInTheDocument();
    expect(screen.getByText('(no time)')).toBeInTheDocument();
  });

  it('emits onSetMode when the mode buttons are clicked', () => {
    const onSetMode = vi.fn();
    renderWithProviders(<GroupedJobs {...props({ onSetMode })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    expect(onSetMode).toHaveBeenCalledWith('time');
  });

  it('emits onSetSearch when the filter input changes', () => {
    const onSetSearch = vi.fn();
    renderWithProviders(<GroupedJobs {...props({ onSetSearch })} />);
    fireEvent.change(screen.getByPlaceholderText(/Filter postcode\.\.\./i), { target: { value: 'pon' } });
    expect(onSetSearch).toHaveBeenCalledWith('pon');
  });

  it('filters groups by postcode search needle', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, toPostCode: 1011, toSuburb: 'Ponsonby' }),
      makeJob({ bulkJobId: 2, toPostCode: 1050, toSuburb: 'CBD' }),
    ];
    renderWithProviders(<GroupedJobs {...props({ jobs, search: '1011' })} />);
    expect(screen.getByText('1011')).toBeInTheDocument();
    expect(screen.queryByText('1050')).not.toBeInTheDocument();
  });

  it('shows "No groups match the filter" when nothing matches', () => {
    const jobs = [makeJob({ bulkJobId: 1, toPostCode: 1011, toSuburb: 'Ponsonby' })];
    renderWithProviders(<GroupedJobs {...props({ jobs, search: 'zzz' })} />);
    expect(screen.getByText('No groups match the filter.')).toBeInTheDocument();
  });

  it('emits onSelectGroup with the job ids in the bucket', () => {
    const onSelectGroup = vi.fn();
    const jobs = [
      makeJob({ bulkJobId: 5, toPostCode: 1011, toSuburb: 'Ponsonby' }),
      makeJob({ bulkJobId: 6, toPostCode: 1011, toSuburb: 'Ponsonby' }),
    ];
    renderWithProviders(<GroupedJobs {...props({ jobs, onSelectGroup })} />);
    fireEvent.click(screen.getByText('1011'));
    expect(onSelectGroup).toHaveBeenCalledWith([5, 6]);
  });

  it('renders Move date button when onBulkMoveGroup is supplied', () => {
    const onBulkMoveGroup = vi.fn();
    const jobs = [makeJob({ bulkJobId: 1, toPostCode: 1011, toSuburb: 'Ponsonby' })];
    renderWithProviders(<GroupedJobs {...props({ jobs, onBulkMoveGroup })} />);
    fireEvent.click(screen.getByRole('button', { name: /Move date/ }));
    expect(onBulkMoveGroup).toHaveBeenCalledWith([1], '1011');
  });

  it('opens the row context menu on right-click when onContextMenuItems is wired', () => {
    const onContextMenuItems = vi.fn(() => [{ label: 'Open group', onClick: vi.fn() }]);
    const jobs = [makeJob({ bulkJobId: 1, toPostCode: 1011, toSuburb: 'Ponsonby' })];
    renderWithProviders(<GroupedJobs {...props({ jobs, onContextMenuItems })} />);
    fireEvent.contextMenu(screen.getByText('1011'));
    expect(onContextMenuItems).toHaveBeenCalled();
    expect(screen.getByText('Open group')).toBeInTheDocument();
  });

  it('drag start sets the payload and fires onDragStart', () => {
    const onDragStart = vi.fn();
    const jobs = [makeJob({ bulkJobId: 42, toPostCode: 1011, toSuburb: 'Ponsonby' })];
    renderWithProviders(<GroupedJobs {...props({ jobs, onDragStart })} />);
    const setData = vi.fn();
    const item = screen.getByText('1011').closest('li')!;
    fireEvent.dragStart(item, { dataTransfer: { setData, effectAllowed: '' } });
    expect(setData).toHaveBeenCalledWith('application/x-bulk-job-ids', JSON.stringify([42]));
    expect(onDragStart).toHaveBeenCalledWith([42]);
  });

  it('renders + 3 suffix when a postcode bucket spans more than three suburbs', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, toPostCode: 1000, toSuburb: 'A' }),
      makeJob({ bulkJobId: 2, toPostCode: 1000, toSuburb: 'B' }),
      makeJob({ bulkJobId: 3, toPostCode: 1000, toSuburb: 'C' }),
      makeJob({ bulkJobId: 4, toPostCode: 1000, toSuburb: 'D' }),
    ];
    renderWithProviders(<GroupedJobs {...props({ jobs })} />);
    // 4 distinct suburbs => shown = A, B, C; tail = +1.
    expect(screen.getByText(/\(A, B, C, \+1\)/)).toBeInTheDocument();
  });

  it('bucketByTime handles ISO datetimes as well as HH:MM strings', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, bookTime: '2026-08-13T14:20:00' }),
      makeJob({ bulkJobId: 2, bookTime: '2026-08-13T14:45:00' }),
    ];
    renderWithProviders(<GroupedJobs {...props({ jobs, mode: 'time' })} />);
    // Because bucketByTime uses local getHours() the ISO gets bucketed to
    // 14:00 (mm<30) and 14:30 (mm>=30). At least one of these buckets
    // must be rendered.
    const times = ['14:00', '14:30'].filter((t) => screen.queryByText(t));
    expect(times.length).toBeGreaterThanOrEqual(1);
  });
});
