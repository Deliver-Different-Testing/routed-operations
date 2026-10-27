import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LegZonePicker } from './ChainBuilder';

/**
 * A tick on a schedule leg is a zone NUMBER, and a number only means
 * something next to a depot: the availability function resolves it by joining
 * the zone's depot to the schedule's region. The picker it replaced offered
 * bare numbers with no name and no depot filter, which is how Medical
 * Couriers ended up with 77 ticks nobody could read back.
 *
 * These pin the two things that make it readable, because getting either
 * wrong is silent: an operator ticks something that can never match, or a
 * tick that already exists disappears from the screen while the function
 * still ignores it.
 */
const lookups = {
  depots: [], speeds: [], postcodeGroups: [], storageStates: [], linehaulRuns: [],
  zones: [
    { zone: 1, label: 'Hayward', depotId: 36, zipCount: 14, groupLabel: 'Bay Area' },
    { zone: 2, label: 'OAK', depotId: 36, zipCount: 215, groupLabel: 'Bay Area' },
    { zone: 1, label: 'Burbank', depotId: 38, zipCount: 1, groupLabel: 'SoCal' },
    // One depot, one number, two zones. Legitimate on US (Medical Couriers
    // depot 35) and the tick covers both, so it reads as one chip.
    { zone: 7, label: 'Sacramento + SMF', depotId: 35, zipCount: 20, groupLabel: 'Bay Area' },
  ],
} as never;

function setup(over: Partial<Parameters<typeof LegZonePicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <LegZonePicker
      title="Zones this leg fulfils"
      depotId={36}
      selected={[]}
      lookups={lookups}
      onChange={onChange}
      {...over}
    />,
  );
  return onChange;
}

describe('LegZonePicker', () => {
  it('offers only the zones at this leg depot', () => {
    setup({ depotId: 36 });
    expect(screen.getByText(/Hayward/)).toBeTruthy();
    expect(screen.getByText(/OAK/)).toBeTruthy();
    // Burbank is number 1 as well, but at depot 38. Offering it would let an
    // operator tick something the function can never match on this leg.
    expect(screen.queryByText(/Burbank/)).toBeNull();
  });

  it('shows the zone name and how many postcodes it covers, not a bare number', () => {
    setup({ depotId: 38 });
    expect(screen.getByText(/Burbank/)).toBeTruthy();
    expect(screen.getByText(/\(1\)/)).toBeTruthy();
  });

  it('keeps a ticked number that has no zone at this depot visible rather than hiding it', () => {
    // Zone 9 exists nowhere. The old picker would have offered it forever
    // because its source unions the tick table; hiding it now would leave a
    // tick the operator cannot see and cannot clear.
    setup({ depotId: 36, selected: [9] });
    expect(screen.getByText(/no zone numbered 9 at this depot/)).toBeTruthy();
  });

  it('lets that stale tick be cleared', async () => {
    const onChange = setup({ depotId: 36, selected: [9] });
    await userEvent.click(screen.getByText(/no zone numbered 9 at this depot/));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders nothing when the depot has no zones and nothing is ticked', () => {
    const { container } = render(
      <LegZonePicker
        title="Zones this leg fulfils"
        depotId={99}
        selected={[]}
        lookups={lookups}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the leg has no depot yet', () => {
    // A number without a depot cannot be resolved, so there is nothing
    // truthful to offer until the leg has one.
    const { container } = render(
      <LegZonePicker
        title="Zones this leg fulfils"
        depotId={null}
        selected={[]}
        lookups={lookups}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('adds a tick in sorted order so the saved list is stable', async () => {
    const onChange = setup({ depotId: 36, selected: [2] });
    await userEvent.click(screen.getByText(/Hayward/));
    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it('groups the chips under their zone group heading', () => {
    setup({ depotId: 36 });
    // The heading is what tells an operator whether they are ticking a
    // pricing zone or a coverage shape (US coverage spec 2.1).
    expect(screen.getByText('Bay Area')).toBeTruthy();
  });

  it('shows two zones that share a number at one depot as a single chip', () => {
    setup({ depotId: 35 });
    expect(screen.getByText(/Sacramento \+ SMF/)).toBeTruthy();
  });
});

/**
 * NZ is deliberately untouched. The labelled, depot-scoped list is a US
 * change and the server sends no labelled zones on NZ, so the picker falls
 * back to the bare numbers it has always shown, on every leg, unfiltered.
 *
 * Filtering NZ would have been defensible, since its availability function
 * tests the depot too, but 545 of the 24,068 active ticks on Urgent staging
 * would have started rendering greyed, and that is a visible change nobody
 * asked for.
 */
describe('LegZonePicker on a tenant with no labelled zones (NZ)', () => {
  const nzBase = {
    depots: [], speeds: [], postcodeGroups: [], storageStates: [], linehaulRuns: [],
    zones: [],
    zoneNumbers: [1, 2, 3],
  };
  const nz = nzBase as never;

  it('falls back to the bare number list', () => {
    render(
      <LegZonePicker title="Zones this leg fulfils" depotId={36} selected={[2]}
        lookups={nz} onChange={vi.fn()} />,
    );
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('does not filter that list by depot', () => {
    // A depot with nothing at it must still show every number, because that
    // is what NZ did before and the change was scoped to US.
    render(
      <LegZonePicker title="Zones this leg fulfils" depotId={999} selected={[]}
        lookups={nz} onChange={vi.fn()} />,
    );
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('keeps the Z prefix the Delivery card has always shown', () => {
    render(
      <LegZonePicker title="Zones this leg fulfils" depotId={36} selected={[]}
        lookups={nz} onChange={vi.fn()} hideCheckbox numberPrefix="Z" />,
    );
    expect(screen.getByText('Z1')).toBeTruthy();
  });

  it('still toggles', async () => {
    const onChange = vi.fn();
    render(
      <LegZonePicker title="Zones this leg fulfils" depotId={36} selected={[2]}
        lookups={nz} onChange={onChange} />,
    );
    await userEvent.click(screen.getByText('1'));
    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it('renders nothing when there are no numbers either', () => {
    const { container } = render(
      <LegZonePicker title="Zones this leg fulfils" depotId={36} selected={[]}
        lookups={{ ...nzBase, zoneNumbers: [] } as never} onChange={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });
});
