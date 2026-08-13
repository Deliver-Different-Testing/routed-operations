import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteTypeChip } from './RouteTypeChip';

describe('RouteTypeChip', () => {
  it('renders First/Final Mile label for kind=first-final', () => {
    render(<RouteTypeChip kind="first-final" />);
    expect(screen.getByText('First/Final Mile')).toBeInTheDocument();
  });

  it('renders Middle Mile label for kind=middle', () => {
    render(<RouteTypeChip kind="middle" />);
    expect(screen.getByText('Middle Mile')).toBeInTheDocument();
  });

  it('applies cyan tone class for first-final', () => {
    render(<RouteTypeChip kind="first-final" />);
    expect(screen.getByText('First/Final Mile').className).toContain('bg-brand-cyan');
  });

  it('applies purple tone class for middle', () => {
    render(<RouteTypeChip kind="middle" />);
    expect(screen.getByText('Middle Mile').className).toContain('bg-brand-purple');
  });
});
