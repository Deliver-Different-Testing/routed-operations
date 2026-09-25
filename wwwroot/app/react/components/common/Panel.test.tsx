import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel } from './Panel';

describe('Panel', () => {
  it('renders children', () => {
    render(<Panel>panel body</Panel>);
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('renders the title heading when title is provided', () => {
    render(<Panel title="Runs">body</Panel>);
    expect(screen.getByRole('heading', { name: 'Runs', level: 3 })).toBeInTheDocument();
  });

  it('renders actions when actions node is provided', () => {
    render(<Panel title="Runs" actions={<button type="button">Refresh</button>}>body</Panel>);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('renders the header bar when only actions are provided (no title)', () => {
    render(<Panel actions={<button type="button">Add</button>}>x</Panel>);
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('omits the header bar entirely when neither title nor actions supplied', () => {
    render(<Panel>only body</Panel>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('appends custom className to the container without dropping defaults', () => {
    const { container } = render(<Panel className="w-64">x</Panel>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('w-64');
    expect(root.className).toContain('bg-surface-white');
    expect(root.className).toContain('flex-col');
  });
});
