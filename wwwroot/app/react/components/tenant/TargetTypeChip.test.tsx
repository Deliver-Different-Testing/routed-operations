import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TargetTypeChip } from './TargetTypeChip';

describe('TargetTypeChip', () => {
  it('renders Courier label with cyan tone', () => {
    render(<TargetTypeChip type="Courier" />);
    const el = screen.getByText('Courier');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-cyan-100');
  });

  it('renders Agent label with violet tone', () => {
    render(<TargetTypeChip type="Agent" />);
    const el = screen.getByText('Agent');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-violet-100');
  });

  it('renders NP label with amber tone for NetworkPartner', () => {
    render(<TargetTypeChip type="NetworkPartner" />);
    const el = screen.getByText('NP');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-amber-100');
  });
});
