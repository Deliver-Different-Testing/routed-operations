// F3 (Marcus, 16 Nov release, step 8): "no Save button, no warning seen,
// client not added". The bundle saves on every action and refuses a client
// while it has no schedules, but the refusal was one grey line he did not
// see, and the client picker still opened. Spec 3.2: the picker is disabled
// on an empty bundle, an amber notice with + Schedule sits above it, and the
// modal says changes save as you make them. The add-a-client round trip
// (spec test 6) is the Playwright flow in tests/e2e/schedules-new.spec.ts.

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { BundleModal } from './BundleModal';

const EMPTY_NOTICE = 'Add a schedule to this bundle first. Clients can only be added once it has one.';

function stubBundle(members: Array<Record<string, unknown>>) {
  server.use(
    http.get('*/api/v2/schedule-bundles/9', () => HttpResponse.json({
      response: {
        bundleId: 9, name: 'Waikato chilled', description: null, isActive: true,
        members, clients: [],
      },
    })),
    http.get('*/api/v2/schedules', () => HttpResponse.json({ response: { rows: [], total: 0 } })),
  );
}

const member = {
  scheduleId: 71, name: 'Afternoon Delivery', isDefault: false, clientCount: 0,
  regionName: 'Hamilton', speedName: 'Standard', activeDays: [1, 2, 3, 4, 5],
};

describe('Bundle modal (F3)', () => {
  it('says that changes save as they are made', async () => {
    stubBundle([member]);
    renderWithProviders(<BundleModal bundleId={9} onClose={() => {}} onScheduleClick={() => {}} />);
    expect(await screen.findByText('Changes save as you make them.')).toBeInTheDocument();
  });

  it('on an empty bundle disables the client picker and shows the amber notice with + Schedule', async () => {
    stubBundle([]);
    const user = userEvent.setup();
    renderWithProviders(<BundleModal bundleId={9} onClose={() => {}} onScheduleClick={() => {}} />);

    const notice = await screen.findByTestId('bundle-empty-notice');
    expect(notice).toHaveTextContent(EMPTY_NOTICE);
    expect(screen.getByRole('button', { name: /Add a schedule first/ })).toBeDisabled();
    // m6: the disabled picker says why, programmatically, via the notice.
    expect(screen.getByRole('button', { name: /Add a schedule first/ })).toHaveAccessibleDescription(EMPTY_NOTICE);
    // The old grey line is gone; the notice replaces it.
    expect(screen.queryByText(/This bundle has no schedules yet/)).toBeNull();

    // + Schedule in the notice opens the schedule search.
    await user.click(screen.getByTestId('bundle-empty-notice-add-schedule'));
    expect(screen.getAllByPlaceholderText('Search schedules by name...').length).toBeGreaterThan(0);
  });

  it('with a schedule in the bundle the picker is enabled and there is no notice', async () => {
    stubBundle([member]);
    renderWithProviders(<BundleModal bundleId={9} onClose={() => {}} onScheduleClick={() => {}} />);
    expect(await screen.findByRole('button', { name: /Add clients/ })).toBeEnabled();
    expect(screen.queryByTestId('bundle-empty-notice')).toBeNull();
  });
});
