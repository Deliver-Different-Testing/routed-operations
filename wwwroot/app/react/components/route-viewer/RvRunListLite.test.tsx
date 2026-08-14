import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvRunListLite } from './RvRunListLite';
import type { BulkRun } from '../../services/routeViewerService';

const mkRun = (over: Partial<BulkRun> = {}): BulkRun => ({
  id: 1,
  name: 'RUN-A',
  area: 'AKL',
  suburbs: 'Ponsonby;Grey Lynn',
  fromCities: null,
  toLocationName: null,
  velocity: null,
  hashKey: null,
  status: 'READY',
  jobs: 10,
  incompleteJobs: 3,
  totalPickup: 4,
  incompletePickup: 1,
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

function renderLite(over: Partial<Parameters<typeof RvRunListLite>[0]> = {}) {
  const defaults = {
    variant: 'preAssigned' as const,
    runs: [] as BulkRun[],
    selectedIds: [] as number[],
    onSelect: vi.fn(),
  };
  const props = { ...defaults, ...over };
  renderWithProviders(<RvRunListLite {...props} />);
  return props;
}

describe('RvRunListLite', () => {
  it('renders Pre Assigned title for preAssigned variant', () => {
    renderLite({ variant: 'preAssigned' });
    expect(screen.getByText('Pre Assigned List')).toBeInTheDocument();
  });

  it('renders Returns title for returns variant', () => {
    renderLite({ variant: 'returns' });
    expect(screen.getByText('Returns / Redeliveries List')).toBeInTheDocument();
  });

  it('renders Exceptions title for exceptions variant', () => {
    renderLite({ variant: 'exceptions' });
    expect(screen.getByText('Exceptions List')).toBeInTheDocument();
  });

  it('renders "None." placeholder when no runs match', () => {
    renderLite({ runs: [mkRun({ preAssigned: 0 })] });
    expect(screen.getByText('None.')).toBeInTheDocument();
  });

  it('preAssigned variant filters runs where preAssigned = 1', () => {
    renderLite({
      variant: 'preAssigned',
      runs: [
        mkRun({ id: 1, name: 'YES', preAssigned: 1 }),
        mkRun({ id: 2, name: 'NO', preAssigned: 0 }),
      ],
    });
    expect(screen.getByText('YES')).toBeInTheDocument();
    expect(screen.queryByText('NO')).toBeNull();
  });

  it('returns variant filters runs where hasReturns = true', () => {
    renderLite({
      variant: 'returns',
      runs: [
        mkRun({ id: 1, name: 'RET', hasReturns: true }),
        mkRun({ id: 2, name: 'PLAIN', hasReturns: false }),
      ],
    });
    expect(screen.getByText('RET')).toBeInTheDocument();
    expect(screen.queryByText('PLAIN')).toBeNull();
  });

  it('exceptions variant includes isMissing rows and status V rows', () => {
    renderLite({
      variant: 'exceptions',
      runs: [
        mkRun({ id: 1, name: 'MISS', isMissing: true }),
        mkRun({ id: 2, name: 'VOID', status: 'V' }),
        mkRun({ id: 3, name: 'OKAY', status: 'READY', isMissing: false }),
      ],
    });
    expect(screen.getByText('MISS')).toBeInTheDocument();
    expect(screen.getByText('VOID')).toBeInTheDocument();
    expect(screen.queryByText('OKAY')).toBeNull();
  });

  it('renders per-row cells: name/area/to/jobs/status/courier', () => {
    renderLite({
      variant: 'returns',
      runs: [
        mkRun({
          id: 1,
          name: 'RUN-A',
          area: 'AKL',
          suburbs: 'Ponsonby;Grey Lynn',
          jobs: 10,
          incompleteJobs: 4,
          status: 'READY',
          courierName: 'Kev',
          hasReturns: true,
        }),
      ],
    });
    expect(screen.getByText('RUN-A')).toBeInTheDocument();
    expect(screen.getByText('AKL')).toBeInTheDocument();
    // First suburb before ;
    expect(screen.getByText('Ponsonby')).toBeInTheDocument();
    // jobs (10) - incompleteJobs (4) = 6/10
    expect(screen.getByText('6/10')).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.getByText('Kev')).toBeInTheDocument();
  });

  it('renders dashes when name/area/status/courier are null', () => {
    renderLite({
      variant: 'returns',
      runs: [
        mkRun({
          id: 1,
          name: null,
          area: null,
          status: null,
          courierName: null,
          suburbs: null,
          hasReturns: true,
        }),
      ],
    });
    const dashes = screen.getAllByText('-');
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it('splits the first suburb before comma or semicolon', () => {
    renderLite({
      variant: 'returns',
      runs: [
        mkRun({ id: 1, suburbs: 'A, B, C', hasReturns: true }),
      ],
    });
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('applies selected background class when the row id is in selectedIds', () => {
    renderLite({
      variant: 'returns',
      runs: [mkRun({ id: 9, hasReturns: true })],
      selectedIds: [9],
    });
    expect(document.querySelector('.bg-brand-cyan\\/20')).toBeInTheDocument();
  });

  it('calls onSelect with id and modifier flags on click', () => {
    const onSelect = vi.fn();
    renderLite({
      variant: 'returns',
      runs: [mkRun({ id: 7, name: 'CLICK-ME', hasReturns: true })],
      onSelect,
    });
    fireEvent.click(screen.getByText('CLICK-ME'), { ctrlKey: true, shiftKey: false });
    expect(onSelect).toHaveBeenCalledWith(7, { ctrl: true, shift: false });
  });

  it('honours metaKey as ctrl for macOS parity', () => {
    const onSelect = vi.fn();
    renderLite({
      variant: 'returns',
      runs: [mkRun({ id: 3, name: 'META', hasReturns: true })],
      onSelect,
    });
    fireEvent.click(screen.getByText('META'), { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith(3, { ctrl: true, shift: false });
  });

  it('fires onContextMenu when provided', () => {
    const onContextMenu = vi.fn();
    renderLite({
      variant: 'returns',
      runs: [mkRun({ id: 4, name: 'CTX', hasReturns: true })],
      onContextMenu,
    });
    fireEvent.contextMenu(screen.getByText('CTX'));
    expect(onContextMenu).toHaveBeenCalled();
    expect(onContextMenu.mock.calls[0][1]).toBe(4);
  });

  it('omits onContextMenu wiring when the prop is not provided', () => {
    renderLite({
      variant: 'returns',
      runs: [mkRun({ id: 4, name: 'NO-CTX', hasReturns: true })],
    });
    // Just verify the row still renders; no throw on right-click.
    fireEvent.contextMenu(screen.getByText('NO-CTX'));
    expect(screen.getByText('NO-CTX')).toBeInTheDocument();
  });

  it('applies runColorMap tint on the selected row (backgroundColor + borderLeft)', () => {
    renderLite({
      variant: 'returns',
      runs: [mkRun({ id: 11, name: 'TINT-ME', hasReturns: true })],
      selectedIds: [11],
      runColorMap: { 11: '#7c3aed' },
    });
    const row = screen.getByText('TINT-ME').closest('tr');
    expect(row).not.toBeNull();
    // Inline style carries the tint at 20% alpha + a 4px left border.
    // jsdom normalises the hex we set (#7c3aed) into rgb(124, 58, 237)
    // so match on the rgb form.
    expect(row!.getAttribute('style')).toContain('background-color');
    expect(row!.getAttribute('style')).toMatch(/124,\s*58,\s*237/);
    expect(row!.getAttribute('style')).toContain('border-left');
    // And the default brand-cyan/20 class must NOT be applied when a
    // tint takes over, otherwise the two colours would blend.
    expect(row!.className).not.toContain('bg-brand-cyan/20');
  });

  it('does NOT tint a row that is not in selectedIds even when runColorMap has an entry', () => {
    renderLite({
      variant: 'returns',
      runs: [
        mkRun({ id: 21, name: 'SEL', hasReturns: true }),
        mkRun({ id: 22, name: 'UNSEL', hasReturns: true }),
      ],
      selectedIds: [21],
      runColorMap: { 21: '#0891b2', 22: '#f59e0b' },
    });
    const selRow = screen.getByText('SEL').closest('tr');
    const unselRow = screen.getByText('UNSEL').closest('tr');
    expect(selRow!.getAttribute('style') ?? '').toContain('background-color');
    // Unselected row must fall through to the default hover class and
    // NOT carry an inline background even though its id has a colour.
    const unselStyle = unselRow!.getAttribute('style') ?? '';
    expect(unselStyle).not.toContain('background-color');
  });
});
