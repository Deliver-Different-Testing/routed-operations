import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';

const OPTIONS: MultiSelectOption[] = [
  { value: 'auk', label: 'Auckland' },
  { value: 'wlg', label: 'Wellington' },
  { value: 'chc', label: 'Christchurch' },
];

describe('MultiSelect', () => {
  it('renders the plural label on the trigger when nothing selected', () => {
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Regions/ })).toBeInTheDocument();
  });

  it('renders the label with a count when items are selected', () => {
    render(<MultiSelect label="Regions" options={OPTIONS} selected={['auk', 'wlg']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Regions \(2\)/ })).toBeInTheDocument();
  });

  it('opens the panel on trigger click and shows the option list', () => {
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    expect(screen.getByText('Auckland')).toBeInTheDocument();
    expect(screen.getByText('Wellington')).toBeInTheDocument();
    expect(screen.getByText('Christchurch')).toBeInTheDocument();
  });

  it('adds a value to selected when its checkbox is toggled on', () => {
    const onChange = vi.fn();
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Auckland/ }));
    expect(onChange).toHaveBeenCalledWith(['auk']);
  });

  it('removes a value when its checkbox is toggled off', () => {
    const onChange = vi.fn();
    render(<MultiSelect label="Regions" options={OPTIONS} selected={['auk']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Auckland/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('filters options by search input', async () => {
    const user = userEvent.setup();
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    const search = screen.getByPlaceholderText('Search regions...');
    await user.type(search, 'well');
    expect(screen.getByText('Wellington')).toBeInTheDocument();
    expect(screen.queryByText('Auckland')).not.toBeInTheDocument();
    expect(screen.queryByText('Christchurch')).not.toBeInTheDocument();
  });

  it('Select all picks every visible option', () => {
    const onChange = vi.fn();
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    fireEvent.click(screen.getByRole('button', { name: /Select all/ }));
    expect(onChange).toHaveBeenCalledWith(['auk', 'wlg', 'chc']);
  });

  it('Clear resets the selected list to empty', () => {
    const onChange = vi.fn();
    render(<MultiSelect label="Regions" options={OPTIONS} selected={['auk', 'wlg']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('disables Select all when the filtered list is empty', async () => {
    const user = userEvent.setup();
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    await user.type(screen.getByPlaceholderText('Search regions...'), 'zzz');
    expect(screen.getByRole('button', { name: /Select all/ })).toBeDisabled();
  });

  it('disables Clear when nothing is selected', () => {
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('shows a No matches message when the search filter matches nothing', async () => {
    const user = userEvent.setup();
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    await user.type(screen.getByPlaceholderText('Search regions...'), 'zzz');
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('shows a No options message when options prop is empty', () => {
    render(<MultiSelect label="Regions" options={[]} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    expect(screen.getByText('No options.')).toBeInTheDocument();
  });

  it('shows a selected-count footer when there is at least one selection', () => {
    render(<MultiSelect label="Regions" options={OPTIONS} selected={['auk']} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    expect(screen.getByPlaceholderText('Search regions...')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Search regions...')).not.toBeInTheDocument();
  });

  it('closes when a mousedown fires outside the wrapper', () => {
    render(
      <div>
        <MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} />
        <div data-testid="outside">outside</div>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Regions/ }));
    expect(screen.getByPlaceholderText('Search regions...')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByPlaceholderText('Search regions...')).not.toBeInTheDocument();
  });

  it('applies the minWidth style to the trigger', () => {
    render(<MultiSelect label="Regions" options={OPTIONS} selected={[]} onChange={() => {}} minWidth="12rem" />);
    const trigger = screen.getByRole('button', { name: /Regions/ });
    expect(trigger).toHaveStyle({ minWidth: '12rem' });
  });
});
