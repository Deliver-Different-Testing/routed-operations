import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpeedChip } from './SpeedChip';

describe('SpeedChip', () => {
  it('renders the short name when provided', () => {
    render(<SpeedChip shortName="SD" name="Same Day" groupingName="Same-day" />);
    expect(screen.getByText('SD')).toBeInTheDocument();
  });

  it('falls back to full name when short is empty', () => {
    render(<SpeedChip shortName="" name="Overnight" groupingName="Overnight" />);
    expect(screen.getByText('Overnight')).toBeInTheDocument();
  });

  it('renders dash placeholder when both names empty', () => {
    render(<SpeedChip shortName="" name="" groupingName={null} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('applies orange tone for same-day grouping', () => {
    render(<SpeedChip shortName="SD" name="Same Day" groupingName="Same-day" />);
    expect(screen.getByText('SD').className).toContain('text-brand-orange');
  });

  it('applies cyan tone for overnight grouping', () => {
    render(<SpeedChip shortName="ON" name="Overnight" groupingName="Overnight" />);
    expect(screen.getByText('ON').className).toContain('text-brand-cyan');
  });

  it('applies purple tone for linehaul grouping', () => {
    render(<SpeedChip shortName="LH" name="Linehaul" groupingName="Linehaul" />);
    expect(screen.getByText('LH').className).toContain('text-brand-purple');
  });

  it('applies slate tone for unknown grouping', () => {
    render(<SpeedChip shortName="X" name="Xtra" groupingName="Special" />);
    expect(screen.getByText('X').className).toContain('text-slate-700');
  });

  it('sets a title tooltip with the full service name', () => {
    render(<SpeedChip shortName="SD" name="Same Day" groupingName="Same-day" />);
    expect(screen.getByText('SD')).toHaveAttribute('title', 'Same Day');
  });
});
