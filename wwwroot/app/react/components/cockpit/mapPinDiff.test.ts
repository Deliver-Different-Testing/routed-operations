import { describe, expect, it } from 'vitest';
import { diffPins, routeKey, type Pin } from './mapPinDiff';

// #1018 C3: every save reloads the jobs and runs in the background. The map
// used to clear every marker and polyline and ask HERE for the route again on
// any change at all. It now touches only the markers whose pin changed, and
// asks for the route only when the selected run's stops change.

const pin = (bulkJobId: number, over: Partial<Pin> = {}): Pin => ({
  lat: -36.9, lng: 174.8, label: `J-${bulkJobId}`, kind: 'unassigned',
  bulkJobId, jobNumber: `J-${bulkJobId}`, runId: null, ...over,
});

const byId = (pins: Pin[]) => new Map(pins.map((p) => [p.bulkJobId, p]));

describe('diffPins', () => {
  it('leaves the markers alone when a reload brings back the same pins as new objects', () => {
    const before = [pin(1), pin(2)];
    const after = [pin(1), pin(2)];
    expect(diffPins(byId(before), after)).toEqual({ add: [], remove: [], update: [] });
  });

  it('adds a new job, removes a gone job and updates only the job that moved', () => {
    const before = [pin(1), pin(2), pin(3)];
    const after = [pin(1), pin(2, { lat: -36.95 }), pin(4)];
    const d = diffPins(byId(before), after);
    expect(d.add.map((p) => p.bulkJobId)).toEqual([4]);
    expect(d.remove).toEqual([3]);
    expect(d.update.map((p) => p.bulkJobId)).toEqual([2]);
  });

  it('updates a pin whose colour, sequence or run changed, as the icon and handlers depend on them', () => {
    const before = [pin(1), pin(2), pin(3), pin(4)];
    const after = [
      pin(1, { kind: 'sequenced', sequence: 2 }),
      pin(2, { runId: 20, kind: 'delivery' }),
      pin(3, { kind: 'multiRun', colour: '#ff9000' }),
      pin(4, { label: 'Stop 1 - J-4' }),
    ];
    expect(diffPins(byId(before), after).update.map((p) => p.bulkJobId)).toEqual([1, 2, 3, 4]);
  });
});

describe('routeKey', () => {
  const stops = [
    pin(1, { kind: 'start', sequence: 1 }),
    pin(2, { kind: 'sequenced', sequence: 2 }),
    pin(3, { kind: 'end', sequence: 3 }),
  ];

  it('is the same when only a job outside the run changed', () => {
    const other = pin(9);
    expect(routeKey([...stops, other])).toBe(routeKey([...stops, pin(9, { lat: -37.1 })]));
  });

  it('changes when the run is re-ordered', () => {
    const reordered = [
      pin(1, { kind: 'start', sequence: 1 }),
      pin(3, { kind: 'sequenced', sequence: 2 }),
      pin(2, { kind: 'end', sequence: 3 }),
    ];
    expect(routeKey(reordered)).not.toBe(routeKey(stops));
  });

  it('changes when a stop is added or removed', () => {
    expect(routeKey(stops.slice(0, 2))).not.toBe(routeKey(stops));
  });

  it('changes when a stop moved, so the line follows a GPS fix', () => {
    const moved = stops.map((p) => (p.bulkJobId === 2 ? { ...p, lat: -36.99 } : p));
    expect(routeKey(moved)).not.toBe(routeKey(stops));
  });

  it('is empty when there is no route to draw (no run selected, or one stop)', () => {
    expect(routeKey([pin(1), pin(2)])).toBe('');
    expect(routeKey([pin(1, { kind: 'start', sequence: 1 })])).toBe('');
  });

  it('lists the stops in sequence order for the route request', () => {
    const shuffled = [stops[2], stops[0], stops[1]];
    expect(routeKey(shuffled)).toBe(routeKey(stops));
  });
});
