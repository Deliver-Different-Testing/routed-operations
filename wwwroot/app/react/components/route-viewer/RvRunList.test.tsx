import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvRunList, type ViewMode } from './RvRunList';
import type { BulkRun } from '../../services/routeViewerService';

// Minimal DataTransfer stub - jsdom doesn't ship one. We store
// mime->value pairs in a plain map, expose `types` via a getter,
// and mimic the setData / getData API RvRunList's handlers use.
function makeDT(initial: Record<string, string> = {}) {
  const bag = new Map<string, string>(Object.entries(initial));
  return {
    getData: (type: string) => bag.get(type) ?? '',
    setData: (type: string, value: string) => { bag.set(type, value); },
    get types() { return Array.from(bag.keys()); },
    dropEffect: 'none',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

const mkRun = (over: Partial<BulkRun> = {}): BulkRun => ({
  id: 1,
  name: 'RUN-A',
  area: 'AKL',
  suburbs: 'Ponsonby',
  fromCities: null,
  toLocationName: null,
  velocity: null,
  hashKey: null,
  status: 'READY',
  jobs: 10,
  incompleteJobs: 3,
  totalPickup: 5,
  incompletePickup: 2,
  hasReturns: false,
  returnsTotal: 0,
  isMissing: false,
  preAssigned: 0,
  isActive: 1,
  courierName: 'Kev',
  courierCode: 'KEV',
  courierPercentageFormatted: null,
  courierOnlineStatus: null,
  courierOfflineMins: null,
  agentName: null,
  isNpAgent: false,
  ...over,
});

function renderList(over: Partial<Parameters<typeof RvRunList>[0]> = {}) {
  const defaults = {
    runs: [mkRun()],
    selectedIds: [],
    onSelect: vi.fn(),
    viewMode: 'Combined' as ViewMode,
    onViewModeChange: vi.fn(),
  };
  const props = { ...defaults, ...over };
  renderWithProviders(<RvRunList {...props} />);
  return props;
}

describe('RvRunList', () => {
  it('renders one row per run', () => {
    renderList({ runs: [mkRun({ id: 1, name: 'RUN-A' }), mkRun({ id: 2, name: 'RUN-B' })] });
    expect(screen.getByText('RUN-A')).toBeInTheDocument();
    expect(screen.getByText('RUN-B')).toBeInTheDocument();
  });

  it('renders empty state message', () => {
    renderList({ runs: [] });
    expect(screen.getByText(/No runs for this date/)).toBeInTheDocument();
  });

  it('renders loading label when isLoading=true', () => {
    renderList({ runs: [], isLoading: true });
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('shows P badge for preAssigned run', () => {
    renderList({ runs: [mkRun({ preAssigned: 1 })] });
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('shows NP badge for isNpAgent', () => {
    renderList({ runs: [mkRun({ isNpAgent: true, agentName: 'NP1' })] });
    expect(screen.getByText('NP')).toBeInTheDocument();
  });

  it('forwards click with modifier keys', async () => {
    const props = renderList({
      runs: [mkRun({ id: 5, name: 'RUN-5' })],
    });
    const user = userEvent.setup();
    await user.click(screen.getByText('RUN-5'));
    expect(props.onSelect).toHaveBeenCalledWith(5, expect.any(Object));
  });

  it('switches view mode when Inbound clicked', async () => {
    const props = renderList();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Inbound' }));
    expect(props.onViewModeChange).toHaveBeenCalledWith('Inbound');
  });

  it('renders Inbound cell values from totalPickup + incompletePickup', () => {
    renderList({
      viewMode: 'Inbound' as ViewMode,
      runs: [mkRun({ totalPickup: 8, incompletePickup: 4 })],
    });
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('cell math clamps negatives to 0', () => {
    renderList({
      viewMode: 'Outbound' as ViewMode,
      // jobs=1, totalPickup=5 -> Outbound top = -4 -> clamped to 0
      runs: [mkRun({ jobs: 1, totalPickup: 5, incompleteJobs: 0, incompletePickup: 3 })],
    });
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('sorts on Name column click + toggles direction', async () => {
    renderList({
      runs: [
        mkRun({ id: 1, name: 'Zeta' }),
        mkRun({ id: 2, name: 'Alpha' }),
      ],
    });
    const user = userEvent.setup();
    const header = screen.getByText(/^Run/);
    // Already sorted asc by name by default
    const rows = screen.getAllByRole('row');
    // First body row = Alpha
    expect(rows[1]).toHaveTextContent('Alpha');
    // Toggle to desc
    await user.click(header);
    const rowsDesc = screen.getAllByRole('row');
    expect(rowsDesc[1]).toHaveTextContent('Zeta');
  });

  it('applies status class for READY (green)', () => {
    const { container } = renderWithProviders(
      <RvRunList
        runs={[mkRun({ status: 'READY' })]}
        selectedIds={[]}
        onSelect={vi.fn()}
        viewMode="Combined"
        onViewModeChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.bg-green-100')).toBeInTheDocument();
  });

  it('renders VelocityDot for each velocity color', () => {
    const runs = [
      mkRun({ id: 1, name: 'r', velocity: 'red' }),
      mkRun({ id: 2, name: 's', velocity: 'orange' }),
      mkRun({ id: 3, name: 't', velocity: 'green' }),
      mkRun({ id: 4, name: 'u', velocity: 'done' }),
      mkRun({ id: 5, name: 'v', velocity: null }),
    ];
    renderList({ runs });
    expect(document.querySelector('.bg-orange-500')).toBeInTheDocument();
    expect(document.querySelector('.bg-green-500')).toBeInTheDocument();
  });

  it('shows selected row background', () => {
    const { container } = renderWithProviders(
      <RvRunList
        runs={[mkRun({ id: 9 })]}
        selectedIds={[9]}
        onSelect={vi.fn()}
        viewMode="Combined"
        onViewModeChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.bg-brand-cyan\\/20')).toBeInTheDocument();
  });

  it('calls onDropRunJobs with parsed jobIds + fromRunId when a rv-run-jobs payload is dropped', () => {
    const onDropRunJobs = vi.fn();
    renderList({
      runs: [mkRun({ id: 42, name: 'TARGET' })],
      onDropRunJobs,
    });
    const row = screen.getByText('TARGET').closest('tr')!;
    const dt = makeDT({
      'application/rv-run-jobs': JSON.stringify({ fromRunId: 11, jobIds: [1001, 1002] }),
    });
    fireEvent.dragOver(row, { dataTransfer: dt });
    fireEvent.drop(row, { dataTransfer: dt });
    expect(onDropRunJobs).toHaveBeenCalledWith(42, 11, [1001, 1002]);
  });

  it('does NOT call onDropRunJobs when the payload JSON is malformed', () => {
    const onDropRunJobs = vi.fn();
    const onDropCourier = vi.fn();
    renderList({
      runs: [mkRun({ id: 42, name: 'TARGET' })],
      onDropRunJobs,
      onDropCourier,
    });
    const row = screen.getByText('TARGET').closest('tr')!;
    const dt = makeDT({ 'application/rv-run-jobs': '{not json' });
    fireEvent.drop(row, { dataTransfer: dt });
    expect(onDropRunJobs).not.toHaveBeenCalled();
    expect(onDropCourier).not.toHaveBeenCalled();
  });

  it('still routes courier payload to onDropCourier when both drop handlers are wired', () => {
    const onDropRunJobs = vi.fn();
    const onDropCourier = vi.fn();
    renderList({
      runs: [mkRun({ id: 42, name: 'TARGET' })],
      onDropRunJobs,
      onDropCourier,
    });
    const row = screen.getByText('TARGET').closest('tr')!;
    const dt = makeDT({ 'application/rv-courier-code': 'KEV' });
    fireEvent.drop(row, { dataTransfer: dt });
    expect(onDropCourier).toHaveBeenCalledWith(42, 'KEV');
    expect(onDropRunJobs).not.toHaveBeenCalled();
  });

  it('ignores an rv-run-jobs payload with empty jobIds', () => {
    const onDropRunJobs = vi.fn();
    renderList({
      runs: [mkRun({ id: 42, name: 'TARGET' })],
      onDropRunJobs,
    });
    const row = screen.getByText('TARGET').closest('tr')!;
    const dt = makeDT({
      'application/rv-run-jobs': JSON.stringify({ fromRunId: 11, jobIds: [] }),
    });
    fireEvent.drop(row, { dataTransfer: dt });
    expect(onDropRunJobs).not.toHaveBeenCalled();
  });
});
