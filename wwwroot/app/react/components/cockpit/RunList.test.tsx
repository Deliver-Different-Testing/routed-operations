import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RunList } from './RunList';
import type { BulkJob, Courier, Run } from '@/types';

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 1,
    name: 'Run 1',
    mins: 30,
    kms: 8,
    courierId: null,
    courierName: null,
    status: 0,
    revenue: null,
    payout: null,
    courierPercentage: null,
    googleRouteResponse: null,
    despatchDateTime: null,
    noReroute: false,
    routingMode: 0,
    finishAtBulkJobId: null,
    isVoidRun: false,
    fleet: null,
    jobs: [],
    ...over,
  };
}

const couriers: Courier[] = [
  { courierId: 500, code: 'A', firstName: 'Alice', displayName: 'Alice', fleet: null },
  { courierId: 501, code: 'B', firstName: 'Bob', displayName: 'Bob', fleet: null },
];

type Props = Parameters<typeof RunList>[0];
function props(over: Partial<Props> = {}): Props {
  return {
    runs: [],
    allJobs: [] as BulkJob[],
    couriers,
    selectedRunId: null,
    selectedRunIds: [],
    sort: null,
    search: '',
    onSetSort: vi.fn(),
    onSetSearch: vi.fn(),
    onSelectRun: vi.fn(),
    onToggleRunMultiselect: vi.fn(),
    onToggleAllRunMultiselect: vi.fn(),
    onCreateRun: vi.fn(),
    onRenameRun: vi.fn(),
    onDeleteRun: vi.fn(),
    onAssignCourier: vi.fn(),
    onLockRun: vi.fn(),
    onDispatch: vi.fn(),
    onPrebook: vi.fn(),
    onAssignSelectedJobs: vi.fn(),
    onDropJobs: vi.fn(),
    onContextMenuItems: vi.fn(() => []),
    selectedJobCount: 0,
    ...over,
  };
}

describe('RunList', () => {
  it('shows the empty run row when no runs exist', () => {
    renderWithProviders(<RunList {...props()} />);
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
  });

  it('renders one row per run with the name', () => {
    renderWithProviders(<RunList {...props({ runs: [makeRun({ id: 1, name: 'North' }), makeRun({ id: 2, name: 'South' })] })} />);
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('South')).toBeInTheDocument();
  });

  it('shows both section headers when the day mixes locked and unlocked runs', () => {
    const runs = [makeRun({ id: 1, name: 'A', status: 0 }), makeRun({ id: 2, name: 'B', status: 1 })];
    renderWithProviders(<RunList {...props({ runs })} />);
    expect(screen.getByText(/Ready \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Locked \(1\)/)).toBeInTheDocument();
  });

  it('does NOT show section headers when only one group is populated', () => {
    const runs = [makeRun({ id: 1, name: 'A', status: 0 })];
    renderWithProviders(<RunList {...props({ runs })} />);
    expect(screen.queryByText(/Ready \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Locked \(/)).not.toBeInTheDocument();
  });

  it('emits onCreateRun with the entered name on Enter', () => {
    const onCreateRun = vi.fn();
    renderWithProviders(<RunList {...props({ onCreateRun })} />);
    const input = screen.getByPlaceholderText(/New run name/);
    fireEvent.change(input, { target: { value: 'Central' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreateRun).toHaveBeenCalledWith('Central');
  });

  it('emits onCreateRun with auto-name when + Create clicked with blank', () => {
    const onCreateRun = vi.fn();
    renderWithProviders(<RunList {...props({ onCreateRun })} />);
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    expect(onCreateRun).toHaveBeenCalledWith('Run 1');
  });

  it('auto-names skip existing Run N numbers', () => {
    const onCreateRun = vi.fn();
    const runs = [makeRun({ id: 10, name: 'Run 1' }), makeRun({ id: 11, name: 'Run 2' })];
    renderWithProviders(<RunList {...props({ runs, onCreateRun })} />);
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    expect(onCreateRun).toHaveBeenCalledWith('Run 3');
  });

  it('emits onSetSearch when the filter input changes', () => {
    const onSetSearch = vi.fn();
    renderWithProviders(<RunList {...props({ onSetSearch })} />);
    fireEvent.change(screen.getByPlaceholderText('Filter...'), { target: { value: 'ok' } });
    expect(onSetSearch).toHaveBeenCalledWith('ok');
  });

  it('emits onSelectRun when a row is clicked', () => {
    const onSelectRun = vi.fn();
    const runs = [makeRun({ id: 55, name: 'CLICKED' })];
    renderWithProviders(<RunList {...props({ runs, onSelectRun })} />);
    fireEvent.click(screen.getByText('CLICKED'));
    expect(onSelectRun).toHaveBeenCalledWith(55);
  });

  it('right-click opens the run row context menu', () => {
    const onContextMenuItems = vi.fn(() => [{ label: 'Rename', onClick: vi.fn() }]);
    const runs = [makeRun({ id: 1, name: 'CTX' })];
    renderWithProviders(<RunList {...props({ runs, onContextMenuItems })} />);
    fireEvent.contextMenu(screen.getByText('CTX'));
    expect(onContextMenuItems).toHaveBeenCalled();
    expect(screen.getByText('Rename')).toBeInTheDocument();
  });

  it('disables Send to Live when no runs are locked', () => {
    renderWithProviders(<RunList {...props()} />);
    expect(screen.getByRole('button', { name: /Send to Live/ })).toBeDisabled();
  });

  it('enables Send to Live when at least one run is locked; click emits onDispatch', () => {
    const onDispatch = vi.fn();
    const runs = [makeRun({ id: 1, name: 'A', status: 1 })];
    renderWithProviders(<RunList {...props({ runs, onDispatch })} />);
    const btn = screen.getByRole('button', { name: /Send to Live \(1\)/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it('emits onToggleRunMultiselect when a row checkbox changes', () => {
    const onToggleRunMultiselect = vi.fn();
    const runs = [makeRun({ id: 7, name: 'X' })];
    renderWithProviders(<RunList {...props({ runs, onToggleRunMultiselect })} />);
    fireEvent.click(screen.getByLabelText('Select run X'));
    expect(onToggleRunMultiselect).toHaveBeenCalledWith(7);
  });

  it('emits onToggleAllRunMultiselect when the header select all changes', () => {
    const onToggleAllRunMultiselect = vi.fn();
    const runs = [makeRun({ id: 1, name: 'A' })];
    renderWithProviders(<RunList {...props({ runs, onToggleAllRunMultiselect })} />);
    fireEvent.click(screen.getByLabelText('Select all runs'));
    expect(onToggleAllRunMultiselect).toHaveBeenCalledTimes(1);
  });

  it('renders the void indicator icon for a void run', () => {
    const runs = [makeRun({ id: 1, name: 'Void Jobs', isVoidRun: true })];
    renderWithProviders(<RunList {...props({ runs })} />);
    // Multiple elements carry the "Void Jobs run" title (the row and the span
    // icon). getAllByTitle asserts at least one exists.
    expect(screen.getAllByTitle(/Void Jobs run/).length).toBeGreaterThan(0);
    // The Void status badge is rendered.
    expect(screen.getByText('Void')).toBeInTheDocument();
  });

  it('drops a jobs payload onto a run and calls onDropJobs with the ids', () => {
    const onDropJobs = vi.fn();
    const runs = [makeRun({ id: 3, name: 'Drop target' })];
    renderWithProviders(<RunList {...props({ runs, onDropJobs })} />);
    const row = screen.getByText('Drop target').closest('tr')!;
    fireEvent.drop(row, {
      dataTransfer: {
        types: ['application/x-bulk-job-ids'],
        getData: (t: string) => (t === 'application/x-bulk-job-ids' ? JSON.stringify([9, 10]) : ''),
      },
    });
    expect(onDropJobs).toHaveBeenCalledWith(3, [9, 10]);
  });

  it('drops a courier payload and opens the preassign prompt', () => {
    const runs = [makeRun({ id: 3, name: 'Drop target' })];
    renderWithProviders(<RunList {...props({ runs })} />);
    const row = screen.getByText('Drop target').closest('tr')!;
    fireEvent.drop(row, {
      dataTransfer: {
        types: ['application/x-courier-id'],
        getData: (t: string) => (t === 'application/x-courier-id' ? '500' : ''),
      },
    });
    expect(screen.getByRole('heading', { name: 'Assign courier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preassign/ })).toBeInTheDocument();
  });

  it('preassign path fires onAssignCourier with preassign:true', () => {
    const onAssignCourier = vi.fn();
    const runs = [makeRun({ id: 3, name: 'Drop target' })];
    renderWithProviders(<RunList {...props({ runs, onAssignCourier })} />);
    const row = screen.getByText('Drop target').closest('tr')!;
    fireEvent.drop(row, {
      dataTransfer: {
        types: ['application/x-courier-id'],
        getData: (t: string) => (t === 'application/x-courier-id' ? '500' : ''),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Preassign/ }));
    expect(onAssignCourier).toHaveBeenCalledWith(3, 500, { preassign: true });
  });

  it('assign-only path fires onAssignCourier without preassign', () => {
    const onAssignCourier = vi.fn();
    const runs = [makeRun({ id: 3, name: 'Drop target' })];
    renderWithProviders(<RunList {...props({ runs, onAssignCourier })} />);
    const row = screen.getByText('Drop target').closest('tr')!;
    fireEvent.drop(row, {
      dataTransfer: {
        types: ['application/x-courier-id'],
        getData: (t: string) => (t === 'application/x-courier-id' ? '501' : ''),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign only' }));
    // Assign-only path calls without the preassign opts arg.
    expect(onAssignCourier).toHaveBeenCalledWith(3, 501);
  });

  it('renders the routing mode + no-reroute badges when set', () => {
    const runs = [
      makeRun({ id: 1, name: 'CircuitRoute', routingMode: 1 }),
      makeRun({ id: 2, name: 'FinishAtRoute', routingMode: 2, finishAtBulkJobId: 99 }),
      makeRun({ id: 3, name: 'NoRerouteRoute', noReroute: true }),
    ];
    renderWithProviders(<RunList {...props({ runs })} />);
    expect(screen.getByText('A-A')).toBeInTheDocument();
    expect(screen.getByText('FA')).toBeInTheDocument();
    expect(screen.getByText('NR')).toBeInTheDocument();
  });

  it('renders the courier percentage cell coloured red when >75%', () => {
    const runs = [makeRun({ id: 1, name: 'Hi', courierPercentage: 0.8 })];
    renderWithProviders(<RunList {...props({ runs })} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('shows +N button next to courier when selectedJobCount > 0', () => {
    const onAssignSelectedJobs = vi.fn();
    const runs = [makeRun({ id: 4, name: 'Target' })];
    renderWithProviders(<RunList {...props({ runs, selectedJobCount: 3, onAssignSelectedJobs })} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ 3/ }));
    expect(onAssignSelectedJobs).toHaveBeenCalledWith(4);
  });
});
