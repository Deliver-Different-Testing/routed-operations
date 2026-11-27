// UC #1115 M2, new schedule editor. A leg with "Discount additional items"
// off charges every additional item the full linehaul price (WS_/DD_
// stpBulkScheduleJob_InsertChildJobs, @LinehaulAddonItemAmount). New legs
// therefore start ticked; legs loaded from the database keep what they have,
// and NULL keeps reading as off (no bulk price change, decision D1).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { ChainBuilder, type Leg, type LinehaulLeg } from './ChainBuilder';
import { ZONE_PERCENT_TOO_HIGH_MESSAGE, BOTH_CHARGED_WARNING, LINEHAUL_LABELS } from '../../lib/linehaulLegRules';

const LOOKUPS = { depots: [], speeds: [], postcodeGroups: [], storageStates: [], linehaulRuns: [] };

function loadedLeg(patch: Partial<LinehaulLeg> = {}): LinehaulLeg {
  return {
    type: 'linehaul', linehaulRunId: null, fromDepotId: 1, toDepotId: 2,
    dayOffset: 1, transitMinutes: 180, speedId: null,
    amount: 30, amountPercentage: 0,
    insertToBulk: false, applyDiscount: true, applyAddOnPercentage: null,
    name: 'WLG to Mainfreight AKL', active: true, weekDay: [1, 1, 1, 1, 1, 0, 0],
    dropOffLocationId: null, fromClientAddress: null,
    ...patch,
  };
}

function Harness({ initial, spy }: { initial: Leg[]; spy: (legs: Leg[]) => void }) {
  const [legs, setLegs] = useState<Leg[]>(initial);
  return <ChainBuilder legs={legs} lookups={LOOKUPS} onChange={(l) => { spy(l); setLegs(l); }} />;
}

const lastLinehaul = (spy: ReturnType<typeof vi.fn>) =>
  (spy.mock.calls[spy.mock.calls.length - 1][0] as Leg[]).find((l) => l.type === 'linehaul') as LinehaulLeg;

describe('ChainBuilder linehaul pricing fields (UC #1115)', () => {
  it('a NEW linehaul leg starts with "Discount additional items" on', async () => {
    const spy = vi.fn();
    render(<Harness initial={[]} spy={spy} />);
    await userEvent.click(screen.getByRole('button', { name: /LINEHAUL/ }));
    expect(lastLinehaul(spy).applyAddOnPercentage).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Discount additional items/ })).toBeChecked();
  });

  it('a loaded leg with NULL stays unticked, and nothing is written until the operator clicks', async () => {
    const spy = vi.fn();
    render(<Harness initial={[loadedLeg()]} spy={spy} />);
    expect(screen.getByRole('checkbox', { name: /Discount additional items/ })).not.toBeChecked();
    expect(spy).not.toHaveBeenCalled();
  });

  it('unticking a ticked leg sets false, not null', async () => {
    const spy = vi.fn();
    render(<Harness initial={[loadedLeg({ applyAddOnPercentage: true })]} spy={spy} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Discount additional items/ }));
    expect(lastLinehaul(spy).applyAddOnPercentage).toBe(false);
  });

  it('uses the new labels and help text', () => {
    render(<Harness initial={[loadedLeg()]} spy={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /Apply client discount/ })).toBeInTheDocument();
    expect(screen.getByText('Uses the Discount on the client.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Plus % of delivery zone rate/)).toBeInTheDocument();
    expect(screen.getByText(/Enter 0.5 for 50%/)).toBeInTheDocument();
    expect(
      screen.getByText("Charges each additional item at the client's additional item percentage, else the speed's, else 80%."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Apply schedule discount')).toBeNull();
    expect(screen.queryByText('Apply add-on percentage')).toBeNull();
  });

  it('shows the error for 50 in "Plus % of delivery zone rate"', () => {
    render(<Harness initial={[loadedLeg({ amount: 0, amountPercentage: 50 })]} spy={vi.fn()} />);
    expect(screen.getByText(ZONE_PERCENT_TOO_HIGH_MESSAGE)).toBeInTheDocument();
  });

  it('warns, without an error, when Amount and the zone % are both set (Marcus\'s 30 + 0.5)', () => {
    render(<Harness initial={[loadedLeg({ amount: 30, amountPercentage: 0.5 })]} spy={vi.fn()} />);
    expect(screen.getByText(BOTH_CHARGED_WARNING)).toBeInTheDocument();
    expect(screen.queryByText(ZONE_PERCENT_TOO_HIGH_MESSAGE)).toBeNull();
  });

  it('the leg summary shows 0.5 as "+50% of zone rate", not "+0.5%"', () => {
    render(<Harness initial={[loadedLeg({ amount: 30, amountPercentage: 0.5 })]} spy={vi.fn()} />);
    expect(screen.getByText(/\+50% of zone rate/)).toBeInTheDocument();
    expect(screen.queryByText(/\+0\.5%/)).toBeNull();
  });
});

// SPEC v2 test 8. A Linehaul tab row (BulkLinehaulRate) prices the leg on the quote and on job
// creation, so "Plus % of delivery zone rate" does nothing there and the leg's Amount is not the
// price: hide the one, show the other read-only. Run 43 has a row for schedule 2736 (the #2736
// leg Steve tested), run 44 has none.
describe('ChainBuilder leg priced from the Linehaul tab (UC #1115 test 8)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/linehaul-rates', () => HttpResponse.json({ response: [
        { runId: 43, anySpeed: { rateId: null }, speedCells: [] },
        { runId: 44, anySpeed: { rateId: null }, speedCells: [] },
      ] })),
      http.get('/api/linehaul-rates/runs/:runId/schedules', ({ params }) => HttpResponse.json({ response:
        params.runId === '43' ? [{ rateId: 1, scheduleId: 2736, speedId: null, active: true, amount: 45, amountPercentage: null }] : [],
      })),
    );
  });

  function renderLeg(linehaulRunId: number, spy = vi.fn()) {
    function PricedHarness() {
      const [legs, setLegs] = useState<Leg[]>([loadedLeg({ linehaulRunId, amountPercentage: 0.1 })]);
      return (
        <ChainBuilder legs={legs} lookups={LOOKUPS} onChange={(l) => { spy(l); setLegs(l); }}
          pricing={{ clientIds: [14927], scheduleId: 2736 }} />
      );
    }
    renderWithProviders(<PricedHarness />);
    return spy;
  }

  it('hides "Plus % of delivery zone rate" and makes Amount read-only, keeping the stored Amount', async () => {
    const spy = renderLeg(43);
    expect(await screen.findByText(LINEHAUL_LABELS.amountFromLinehaulTab)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Plus % of delivery zone rate/)).toBeNull();
    const amount = screen.getByLabelText(/Amount \(\$\)/) as HTMLInputElement;
    expect(amount).toHaveAttribute('readonly');
    expect(amount.value).toBe('30');
    await userEvent.type(amount, '9');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a leg with no Linehaul tab row keeps both fields editable', async () => {
    const spy = renderLeg(44);
    const amount = screen.getByLabelText(/Amount \(\$\)/) as HTMLInputElement;
    await waitFor(() => expect(screen.getByLabelText(/Plus % of delivery zone rate/)).toBeInTheDocument());
    expect(amount).not.toHaveAttribute('readonly');
    expect(screen.queryByText(LINEHAUL_LABELS.amountFromLinehaulTab)).toBeNull();
    await userEvent.type(amount, '5');
    expect(lastLinehaul(spy).amount).toBe(305);
  });
});
