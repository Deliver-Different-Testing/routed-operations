import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalCloseButton } from './ModalCloseButton';

describe('ModalCloseButton', () => {
  it('renders a button with an aria-label of Close', () => {
    render(<ModalCloseButton onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('defaults type to button', () => {
    render(<ModalCloseButton onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('type', 'button');
  });

  it('fires onClose when clicked', () => {
    const onClose = vi.fn();
    render(<ModalCloseButton onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('appends custom className without dropping defaults', () => {
    render(<ModalCloseButton onClose={() => {}} className="ml-2" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('ml-2');
    expect(btn.className).toContain('rounded-full');
  });
});
