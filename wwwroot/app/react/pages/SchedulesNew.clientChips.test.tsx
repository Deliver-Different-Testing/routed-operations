import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientChips } from './SchedulesNew';
import type { ScheduleGroupSummary } from '../services/scheduleService';

// D2: a schedule that hides same-lane defaults changes what its clients can
// book without anything else on the row saying so. The list badge is how an
// operator scanning Schedules NEW finds out which schedules do that.

const row = (p: Partial<ScheduleGroupSummary>): ScheduleGroupSummary => ({
  scheduleId: 3001,
  name: 'Medical HAM 8am',
  legacyClientId: null,
  legacyClientCode: null,
  clientCount: 1,
  linkedClientCodes: ['MEDHAM'],
  isDefault: false,
  ...p,
} as ScheduleGroupSummary);

describe('ClientChips - Hides defaults badge (D2)', () => {
  it('shows on a specific schedule with BlockDefaults set', () => {
    render(<ClientChips row={row({ blockDefaults: true })} />);
    expect(screen.getByTestId('row-3001-hides-defaults')).toHaveTextContent('Hides defaults');
  });

  it('is absent when the flag is off or missing', () => {
    const { rerender } = render(<ClientChips row={row({ blockDefaults: false })} />);
    expect(screen.queryByTestId('row-3001-hides-defaults')).toBeNull();
    rerender(<ClientChips row={row({})} />);
    expect(screen.queryByTestId('row-3001-hides-defaults')).toBeNull();
  });
});
