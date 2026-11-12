import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { CopyScheduleModal } from './CopyScheduleModal';
import type { ScheduleGroupSummary } from '../../services/scheduleService';

// D4: a copy is a half-edited schedule, so it starts inactive unless the
// operator ticks Activate. The body has to say so explicitly; the server's
// fallback is the same, but the dialog should not rely on it.

const source = {
  scheduleId: 2908,
  name: 'Waikato Morning Chilled',
  regionName: 'Hamilton',
  clientCount: 0,
} as ScheduleGroupSummary;

function capturePost() {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post('/api/v2/schedules/2908/copy', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ response: { scheduleId: 2999 } });
    }),
  );
  return bodies;
}

describe('CopyScheduleModal - Activate (D4)', () => {
  it('sends isActive false when Activate is left unticked', async () => {
    const bodies = capturePost();
    const user = userEvent.setup();
    renderWithProviders(<CopyScheduleModal source={source} onClose={() => {}} />);

    expect(screen.getByRole('checkbox', { name: /Activate the copy now/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].isActive).toBe(false);
  });

  it('sends isActive true when Activate is ticked', async () => {
    const bodies = capturePost();
    const user = userEvent.setup();
    renderWithProviders(<CopyScheduleModal source={source} onClose={() => {}} />);

    await user.click(screen.getByRole('checkbox', { name: /Activate the copy now/ }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].isActive).toBe(true);
  });
});
