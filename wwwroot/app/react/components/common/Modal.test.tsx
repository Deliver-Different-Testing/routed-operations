import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">body</Modal>);
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('renders title and children when open is true', () => {
    render(<Modal open onClose={() => {}} title="Visible">contents</Modal>);
    expect(screen.getByRole('heading', { name: 'Visible', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('contents')).toBeInTheDocument();
  });

  it('renders footer node when provided', () => {
    render(
      <Modal open onClose={() => {}} title="T" footer={<button type="button">Save</button>}>
        body
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('applies the size class for the requested size', () => {
    const { container } = render(<Modal open onClose={() => {}} title="T" size="2xl">body</Modal>);
    const panel = container.querySelector('.max-w-2xl');
    expect(panel).not.toBeNull();
  });

  it('fires onClose when the close (X) button is clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">x</Modal>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<Modal open onClose={onClose} title="T">x</Modal>);
    const backdrop = container.querySelector('[data-modal-open="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClose when the inner panel is clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">inner body</Modal>);
    fireEvent.click(screen.getByText('inner body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape by default', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">x</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when disableEscapeClose is true', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T" disableEscapeClose>x</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on Escape while loading is true', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T" loading>x</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the close (X) button while loading', () => {
    render(<Modal open onClose={() => {}} title="T" loading>x</Modal>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('renders the loading spinner overlay with loadingMessage', () => {
    render(
      <Modal open onClose={() => {}} title="T" loading loadingMessage="Working...">
        x
      </Modal>,
    );
    expect(screen.getByText('Working...')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('ignores non-Escape keys', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">x</Modal>);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
