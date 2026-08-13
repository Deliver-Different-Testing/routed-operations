import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders children as button text', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('defaults type to button (never form submit)', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('honours an explicit type prop', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('applies primary variant classes by default when variant=primary', () => {
    render(<Button variant="primary">Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-brand-cyan');
  });

  it('applies size classes', () => {
    render(<Button size="sm">S</Button>);
    expect(screen.getByRole('button').className).toContain('text-xs');
  });

  it('applies active-variant classes when active is true', () => {
    render(<Button variant="neutral" active>Auto Zoom</Button>);
    expect(screen.getByRole('button').className).toContain('border-brand-cyan');
  });

  it('applies danger variant class when variant=danger', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('border-error');
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders disabled and blocks click when disabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>Off</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('appends a custom className without overwriting variant classes', () => {
    render(<Button variant="primary" className="w-full">Full</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('w-full');
    expect(btn.className).toContain('bg-brand-cyan');
  });
});
