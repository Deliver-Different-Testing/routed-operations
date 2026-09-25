import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { JobsList } from './JobsList';
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
    amount: 55,
    speed: 10,
    speedName: 'Same Day',
    fromCompany: null,
    fromAddress: '1 Sender St',
    fromSuburb: 'CBD',
    fromPostCode: 1010,
    toCompany: null,
    toAddress: '99 Recipient Rd',
    toSuburb: 'Ponsonby',
    toPostCode: 1011,
    size: 1,
    qty: 1,
    weight: 1,
    courierId: null,
    courierName: 'Alice',
    clientRefa: null,
    clientRefb: null,
    ourRef: null,
    notes: null,
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

type JobsListProps = Parameters<typeof JobsList>[0];

function defaultProps(over: Partial<JobsListProps> = {}): JobsListProps {
  return {
    jobs: [],
    selectedJobId: null,
    selectedJobIds: [],
    sort: null,
    sizeFilter: 'all',
    search: '',
    onSetSort: vi.fn(),
    onSetSizeFilter: vi.fn(),
    onSetSearch: vi.fn(),
    onSelectJob: vi.fn(),
    onToggleMultiselect: vi.fn(),
    onToggleAllMultiselect: vi.fn(),
    onContextMenuItems: vi.fn(() => []),
    ...over,
  };
}

describe('JobsList', () => {
  it('shows the empty-state row when no jobs match', () => {
    renderWithProviders(<JobsList {...defaultProps()} />);
    expect(screen.getByText(/No jobs match the current filters/)).toBeInTheDocument();
  });

  it('renders one row per job with client / job number / suburb / postcode', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, jobNumber: 'A-1', clientCode: 'ACME', toSuburb: 'Ponsonby', toPostCode: 1011 }),
      makeJob({ bulkJobId: 2, jobNumber: 'A-2', clientCode: 'BETA', toSuburb: 'Grey Lynn', toPostCode: 1021 }),
    ];
    renderWithProviders(<JobsList {...defaultProps({ jobs })} />);
    expect(screen.getByText('A-1')).toBeInTheDocument();
    expect(screen.getByText('A-2')).toBeInTheDocument();
    expect(screen.getByText('Ponsonby')).toBeInTheDocument();
    expect(screen.getByText('1011')).toBeInTheDocument();
  });

  it('emits onSetSearch when the filter input changes', () => {
    const onSetSearch = vi.fn();
    renderWithProviders(<JobsList {...defaultProps({ onSetSearch })} />);
    fireEvent.change(screen.getByPlaceholderText('Filter...'), { target: { value: 'ace' } });
    expect(onSetSearch).toHaveBeenCalledWith('ace');
  });

  it('toggles the >100 m3 size filter on click', () => {
    const onSetSizeFilter = vi.fn();
    renderWithProviders(<JobsList {...defaultProps({ onSetSizeFilter })} />);
    fireEvent.click(screen.getByRole('button', { name: /100 m3/ }));
    expect(onSetSizeFilter).toHaveBeenCalledWith('moreThan100Cubic');
  });

  it('toggles the size filter back to all when active', () => {
    const onSetSizeFilter = vi.fn();
    renderWithProviders(<JobsList {...defaultProps({ sizeFilter: 'moreThan100Cubic', onSetSizeFilter })} />);
    fireEvent.click(screen.getByRole('button', { name: /100 m3/ }));
    expect(onSetSizeFilter).toHaveBeenCalledWith('all');
  });

  it('disables the CSV button when the list is empty', () => {
    renderWithProviders(<JobsList {...defaultProps()} />);
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
  });

  it('emits onSetSort when a column header is clicked', () => {
    const onSetSort = vi.fn();
    renderWithProviders(<JobsList {...defaultProps({ jobs: [makeJob()], onSetSort })} />);
    fireEvent.click(screen.getByText(/Job #/));
    expect(onSetSort).toHaveBeenCalledWith(expect.objectContaining({ field: 'jobNumber' }));
  });

  it('emits onSelectJob when a row is clicked', () => {
    const onSelectJob = vi.fn();
    const jobs = [makeJob({ bulkJobId: 77 })];
    renderWithProviders(<JobsList {...defaultProps({ jobs, onSelectJob })} />);
    fireEvent.click(screen.getByText('JOB-1'));
    expect(onSelectJob).toHaveBeenCalledWith(77);
  });

  it('emits onToggleMultiselect when a row checkbox changes', () => {
    const onToggleMultiselect = vi.fn();
    const jobs = [makeJob({ bulkJobId: 88 })];
    renderWithProviders(<JobsList {...defaultProps({ jobs, onToggleMultiselect })} />);
    fireEvent.click(screen.getByLabelText(/Select job JOB-1/));
    expect(onToggleMultiselect).toHaveBeenCalledWith(88);
  });

  it('emits onToggleAllMultiselect when the header checkbox changes', () => {
    const onToggleAllMultiselect = vi.fn();
    const jobs = [makeJob({ bulkJobId: 1 }), makeJob({ bulkJobId: 2 })];
    renderWithProviders(<JobsList {...defaultProps({ jobs, onToggleAllMultiselect })} />);
    fireEvent.click(screen.getByLabelText('Select all'));
    expect(onToggleAllMultiselect).toHaveBeenCalledTimes(1);
  });

  it('renders missing-GPS style + the ! indicator', () => {
    const jobs = [makeJob({ bulkJobId: 3, jobNumber: 'NO-GPS', deliveryLatitude: null })];
    renderWithProviders(<JobsList {...defaultProps({ jobs })} />);
    expect(screen.getByText('NO-GPS')).toBeInTheDocument();
    // The ! marker is a sibling <span> with title=Missing GPS coordinates.
    expect(screen.getByTitle('Missing GPS coordinates')).toBeInTheDocument();
  });

  it('opens the row context menu on right-click and calls onContextMenuItems', () => {
    const onContextMenuItems = vi.fn(() => [{ label: 'Void', onClick: vi.fn() }]);
    const jobs = [makeJob({ bulkJobId: 5 })];
    renderWithProviders(<JobsList {...defaultProps({ jobs, onContextMenuItems })} />);
    fireEvent.contextMenu(screen.getByText('JOB-1'));
    expect(onContextMenuItems).toHaveBeenCalled();
    expect(screen.getByText('Void')).toBeInTheDocument();
  });

  it('marks the currently-selected job row', () => {
    const jobs = [makeJob({ bulkJobId: 9, jobNumber: 'SELECTED' })];
    const { container } = renderWithProviders(
      <JobsList {...defaultProps({ jobs, selectedJobId: 9 })} />
    );
    // Find the <tr> containing SELECTED - it should carry the selection bg class.
    const cell = screen.getByText('SELECTED');
    const row = cell.closest('tr');
    expect(row?.className).toMatch(/brand-cyan/);
    expect(container).toBeTruthy();
  });

  it('sets a drag payload with the current selection ids', () => {
    const jobs = [makeJob({ bulkJobId: 1, jobNumber: 'A' }), makeJob({ bulkJobId: 2, jobNumber: 'B' })];
    renderWithProviders(<JobsList {...defaultProps({ jobs, selectedJobIds: [1, 2] })} />);
    const setData = vi.fn();
    const row = screen.getByText('A').closest('tr')!;
    fireEvent.dragStart(row, {
      dataTransfer: {
        setData,
        effectAllowed: '',
      },
    });
    expect(setData).toHaveBeenCalledWith('application/x-bulk-job-ids', JSON.stringify([1, 2]));
  });

  it('drag on an unselected row sends just that jobs id', () => {
    const jobs = [makeJob({ bulkJobId: 1, jobNumber: 'A' })];
    renderWithProviders(<JobsList {...defaultProps({ jobs })} />);
    const setData = vi.fn();
    const row = screen.getByText('A').closest('tr')!;
    fireEvent.dragStart(row, {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith('application/x-bulk-job-ids', JSON.stringify([1]));
  });
});
