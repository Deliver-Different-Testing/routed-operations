// F3 (Marcus, 16 Nov release, step 8): on an empty bundle the picker still
// opened and let him choose a client, and only the Add button refused. A
// picker the caller disables must not open at all.

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { ClientMultiPicker } from './ClientMultiPicker';

describe('ClientMultiPicker disabled', () => {
  it('a disabled picker cannot be opened', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ClientMultiPicker selected={[]} onChange={() => {}} placeholder="Add a schedule first" disabled />,
    );

    const trigger = screen.getByRole('button', { name: /Add a schedule first/ });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByTestId('client-multi-picker-panel')).toBeNull();
  });
});
