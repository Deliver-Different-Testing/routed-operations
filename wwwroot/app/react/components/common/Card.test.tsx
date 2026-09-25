import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>hello card</Card>);
    expect(screen.getByText('hello card')).toBeInTheDocument();
  });

  it('renders the title heading when title is provided', () => {
    render(<Card title="Details">body</Card>);
    expect(screen.getByRole('heading', { name: 'Details', level: 2 })).toBeInTheDocument();
  });

  it('omits the heading when title is not provided', () => {
    render(<Card>body only</Card>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('appends custom className to the container without dropping defaults', () => {
    const { container } = render(<Card className="w-full custom-x">c</Card>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('w-full');
    expect(root.className).toContain('custom-x');
    expect(root.className).toContain('bg-surface-white');
    expect(root.className).toContain('border-border');
  });
});
