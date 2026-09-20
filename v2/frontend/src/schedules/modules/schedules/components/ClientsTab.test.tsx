// Component tests for the link-row UI: attach picker blockers, visibility switch, detach, override creation.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AttachClientsModal } from './AttachClientsModal';
import { ClientsTab } from './ClientsTab';
import { createEmptySchedule, type Schedule } from '../types';

const clients = [
  { id: 1, name: 'Acme Corporation', shortName: 'ACME' },
  { id: 2, name: 'Globex Industries', shortName: 'GLOBEX' },
  { id: 3, name: 'Initech', shortName: 'INITECH' },
];

function make(id: number, over: Partial<Schedule> = {}): Schedule {
  return { ...createEmptySchedule(), id, rowIds: [], name: `S${id}`, ...over } as Schedule;
}

describe('AttachClientsModal', () => {
  it('greys out blocked clients with the reason and returns the ticked ids', () => {
    const onConfirm = vi.fn();
    render(
      <AttachClientsModal
        isOpen
        title="Attach"
        clients={clients}
        blockerFor={(id) => (id === 1 ? 'already attached' : null)}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    const modal = screen.getByTestId('attach-clients-modal');
    expect(within(modal).getByText('already attached')).toBeTruthy();
    const boxes = within(modal).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.find((b) => b.disabled)).toBeTruthy();
    // tick GLOBEX and INITECH
    fireEvent.click(within(modal).getByLabelText(/Globex/));
    fireEvent.click(within(modal).getByLabelText(/Initech/));
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onConfirm).toHaveBeenCalledWith([2, 3]);
  });

  it('filters by name or code', () => {
    render(<AttachClientsModal isOpen title="Attach" clients={clients} onConfirm={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'glob' } });
    const modal = screen.getByTestId('attach-clients-modal');
    expect(within(modal).queryByText('Acme Corporation')).toBeNull();
    expect(within(modal).getByText('Globex Industries')).toBeTruthy();
  });
});

describe('ClientsTab', () => {
  const base = make(10, { visibility: 'specific', clientIds: [1, 2], clientId: 1 });
  const override = make(11, { visibility: 'specific', clientIds: [3], clientId: 3, isOverride: true, baseScheduleId: 10 });

  it('lists attached clients and detaches one', () => {
    const onDetach = vi.fn();
    render(
      <ClientsTab schedule={base} allSchedules={[base, override]} clients={clients} onChangeVisibility={() => {}} onAttach={() => {}} onDetach={onDetach} />,
    );
    expect(screen.getByText('Acme Corporation')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Remove')[0]);
    expect(onDetach).toHaveBeenCalledWith(1);
  });

  it('switches to a default and hides the attached list', () => {
    const onChangeVisibility = vi.fn();
    render(
      <ClientsTab schedule={base} allSchedules={[base]} clients={clients} onChangeVisibility={onChangeVisibility} onAttach={() => {}} onDetach={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/All clients \(default\)/));
    expect(onChangeVisibility).toHaveBeenCalledWith('all');
  });

  it('shows overrides of the base and creates one for a client', () => {
    const onCreateOverride = vi.fn();
    render(
      <ClientsTab schedule={base} allSchedules={[base, override]} clients={clients} onChangeVisibility={() => {}} onAttach={() => {}} onDetach={() => {}} onCreateOverride={onCreateOverride} />,
    );
    expect(screen.getByText('#11')).toBeTruthy(); // the existing override
    fireEvent.click(screen.getByText('Create override for a client…'));
    const modal = screen.getByTestId('attach-clients-modal');
    // INITECH already has override #11 → blocked; ACME is on the base → allowed with a note
    expect(within(modal).getByText('already has override #11')).toBeTruthy();
    expect(within(modal).getAllByText('on the base — will move to the override')).toHaveLength(2);
    fireEvent.click(within(modal).getByLabelText(/Acme/));
    fireEvent.click(screen.getByRole('button', { name: 'Create override' }));
    expect(onCreateOverride).toHaveBeenCalledWith(1);
  });

  it('an override cannot be made a default', () => {
    render(
      <ClientsTab schedule={override} allSchedules={[base, override]} clients={clients} onChangeVisibility={() => {}} onAttach={() => {}} onDetach={() => {}} />,
    );
    const allRadio = screen.getByLabelText(/All clients \(default\)/) as HTMLInputElement;
    expect(allRadio.disabled).toBe(true);
    expect(screen.getByText(/This is an override of/)).toBeTruthy();
  });
});
