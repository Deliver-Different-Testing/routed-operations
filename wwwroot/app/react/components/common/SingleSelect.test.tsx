import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SingleSelect } from './SingleSelect';

const opts = [
  { value: '1', label: 'Auckland' },
  { value: '2', label: 'Wellington' },
  { value: '3', label: 'Christchurch' },
];

describe('SingleSelect', () => {
  it('renders the plain label when nothing is selected', () => {
    render(<SingleSelect label="Region" options={opts} selected={null} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /^Region/ });
    expect(trigger).toHaveTextContent('Region');
  });

  it('shows the selected option label in the trigger', () => {
    render(<SingleSelect label="Region" options={opts} selected={'2'} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Region: Wellington/ });
    expect(trigger).toBeInTheDocument();
  });

  it('opens the panel + shows all options + the clear affordance', async () => {
    render(<SingleSelect label="Region" options={opts} selected={null} onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Region/ }));
    expect(screen.getByRole('button', { name: 'All regions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auckland' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wellington' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Christchurch' })).toBeInTheDocument();
  });

  it('narrows the option list by search input', async () => {
    render(<SingleSelect label="Region" options={opts} selected={null} onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Region/ }));
    await user.type(screen.getByPlaceholderText(/Search region/), 'well');
    expect(screen.getByRole('button', { name: 'Wellington' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auckland' })).toBeNull();
  });

  it('picks an option and closes the panel', async () => {
    const onChange = vi.fn();
    render(<SingleSelect label="Region" options={opts} selected={null} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Region/ }));
    await user.click(screen.getByRole('button', { name: 'Wellington' }));
    expect(onChange).toHaveBeenCalledWith('2');
    // Panel closed - the option is no longer in the document.
    expect(screen.queryByRole('button', { name: 'Wellington' })).toBeNull();
  });

  it('clears the selection when the clear affordance is picked', async () => {
    const onChange = vi.fn();
    render(<SingleSelect label="Region" options={opts} selected={'1'} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Region: Auckland/ }));
    await user.click(screen.getByRole('button', { name: 'All regions' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('uses a custom clearLabel when provided', async () => {
    render(
      <SingleSelect
        label="Courier"
        options={opts}
        selected={null}
        onChange={vi.fn()}
        clearLabel="All couriers"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Courier/ }));
    expect(screen.getByRole('button', { name: 'All couriers' })).toBeInTheDocument();
  });
});
