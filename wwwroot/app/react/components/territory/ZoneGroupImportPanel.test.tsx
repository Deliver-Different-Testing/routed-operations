// F4 (ZG3), M0 I-6: a row the re-uploaded file leaves out deletes coverage,
// and that is the one change nobody can see on the sheet they edited. So the
// panel must never remove on Apply alone: removal needs its own tick, and an
// upload whose only difference is missing rows has nothing to apply until it
// is ticked.

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { ZoneGroupImportPanel } from './ZoneGroupImportPanel';
import type { ZoneGroupImportPreview } from '../../services/territoryService';

const onlyMissing: ZoneGroupImportPreview = {
  added: [], moved: [], unrecognised: [], unchanged: 2, errors: [], token: 'T9',
  removed: [{ id: 13, code: '1011', zone: 2 }],
};

describe('ZoneGroupImportPanel - removing needs its own tick (I-6)', () => {
  it('has nothing to apply until "also remove" is ticked, and then sends removeMissing', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(http.post('*/api/territory/postcode-groups/5/import/apply', async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ response: { added: 0, moved: 0, removed: 1, keptNotInFile: 0 } });
    }));
    const user = userEvent.setup();
    renderWithProviders(
      <ZoneGroupImportPanel groupId={5} memberWord="postcode" csv="x" fileName="g.csv"
        preview={onlyMissing} onApplied={() => {}} onCancel={() => {}} />,
    );

    expect(screen.getByText(/Not in the file \(1\):/)).toBeInTheDocument();
    expect(screen.getByTestId('pg-import-apply')).toBeDisabled();

    await user.click(screen.getByLabelText('Also remove the 1 postcode not in the file'));
    await user.click(screen.getByTestId('pg-import-apply'));

    expect(body).toEqual({ csv: 'x', token: 'T9', removeMissing: true });
  });

  it('flags unrecognised codes as a warning while still adding them', () => {
    renderWithProviders(
      <ZoneGroupImportPanel groupId={5} memberWord="postcode" csv="x" fileName="g.csv"
        preview={{ ...onlyMissing, removed: [], unrecognised: ['9999'],
          added: [{ line: 4, code: '9999', zone: 4, suburb: '', unrecognised: true }] }}
        onApplied={() => {}} onCancel={() => {}} />,
    );

    expect(screen.getByText(/Unrecognised \(1\):/)).toBeInTheDocument();
    expect(screen.getByText(/They will still be added/)).toBeInTheDocument();
    expect(screen.getByTestId('pg-import-apply')).toBeEnabled();
  });
});

// m7 + n1 (review 19 Nov): the group changed after the preview, so the server
// refused. Keeping the old preview means Apply fails again with the same
// token; the panel re-runs the preview so what is shown is the group as it
// is now, the remove tick is cleared so removal is confirmed again, and the
// refusal carries its reference.
describe('ZoneGroupImportPanel - a refused apply refreshes the preview', () => {
  it('shows the message with its ref, calls onRefresh and clears the remove tick', async () => {
    server.use(http.post('*/api/territory/postcode-groups/5/import/apply', () => HttpResponse.json(
      { message: 'This group has changed since the preview was made, so nothing was saved.', messageId: 'abcdef12-0000-0000-0000-000000000000', code: 'stale' },
      { status: 400 })));
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <ZoneGroupImportPanel groupId={5} memberWord="postcode" csv="x" fileName="g.csv"
        preview={onlyMissing} onApplied={() => {}} onCancel={() => {}} onRefresh={onRefresh} />,
    );

    await user.click(screen.getByLabelText('Also remove the 1 postcode not in the file'));
    await user.click(screen.getByTestId('pg-import-apply'));

    expect(await screen.findByText(/changed since the preview.*\(ref abcdef12\)/)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Also remove the 1 postcode not in the file')).not.toBeChecked();
  });
});

// r3 (review 20 Nov): only a stale token means the group changed. A file
// error or a database refusal says its own words, and the panel must not
// claim "the preview below now shows the group as it is" when it does not.
describe('ZoneGroupImportPanel - other refusals do not refresh', () => {
  it('shows the message with its ref and leaves the preview and the tick alone', async () => {
    server.use(http.post('*/api/territory/postcode-groups/5/import/apply', () => HttpResponse.json(
      { message: 'Nothing was saved. The database refused the change; quote the reference to support.', messageId: '12345678-0000-0000-0000-000000000000' },
      { status: 400 })));
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <ZoneGroupImportPanel groupId={5} memberWord="postcode" csv="x" fileName="g.csv"
        preview={onlyMissing} onApplied={() => {}} onCancel={() => {}} onRefresh={onRefresh} />,
    );

    await user.click(screen.getByLabelText('Also remove the 1 postcode not in the file'));
    await user.click(screen.getByTestId('pg-import-apply'));

    expect(await screen.findByText(/database refused the change.*\(ref 12345678\)/)).toBeInTheDocument();
    expect(screen.queryByText(/now shows the group as it is/)).not.toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Also remove the 1 postcode not in the file')).toBeChecked();
  });
});

// n-b (review 20 Nov): a move into a zone the group does not have creates
// that zone, which is how a typo (9 for 1) looks. The preview says so.
describe('ZoneGroupImportPanel - a move to a new zone is labelled', () => {
  it('marks only the move into a zone the group does not have', () => {
    renderWithProviders(
      <ZoneGroupImportPanel groupId={5} memberWord="postcode" csv="x" fileName="g.csv"
        preview={{ ...onlyMissing, removed: [], moved: [
          { id: 11, code: '0110', fromZone: 1, toZone: 9, line: 2, newZone: true },
          { id: 13, code: '1011', fromZone: 2, toZone: 1, line: 3, newZone: false },
        ] }}
        onApplied={() => {}} onCancel={() => {}} />,
    );

    expect(screen.getByTestId('pg-import-moved')).toHaveTextContent('0110 zone 1 to 9 (new zone), 1011 zone 2 to 1');
  });
});
