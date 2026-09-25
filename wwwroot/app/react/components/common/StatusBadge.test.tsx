import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the label text', () => {
    render(<StatusBadge label="Live" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('applies default kind classes when kind is omitted', () => {
    render(<StatusBadge label="X" />);
    const el = screen.getByText('X');
    expect(el.className).toContain('bg-surface-light');
    expect(el.className).toContain('text-text-secondary');
  });

  it('applies success kind classes', () => {
    render(<StatusBadge label="OK" kind="success" />);
    const el = screen.getByText('OK');
    expect(el.className).toContain('bg-success-bg');
    expect(el.className).toContain('text-success');
  });

  it('applies warning kind classes', () => {
    render(<StatusBadge label="Warn" kind="warning" />);
    const el = screen.getByText('Warn');
    expect(el.className).toContain('bg-warning-bg');
    expect(el.className).toContain('text-warning');
  });

  it('applies error kind classes', () => {
    render(<StatusBadge label="Err" kind="error" />);
    const el = screen.getByText('Err');
    expect(el.className).toContain('bg-error-bg');
    expect(el.className).toContain('text-error');
  });

  it('applies info kind classes', () => {
    render(<StatusBadge label="Info" kind="info" />);
    const el = screen.getByText('Info');
    expect(el.className).toContain('bg-brand-cyan/20');
    expect(el.className).toContain('text-brand-dark');
  });
});
