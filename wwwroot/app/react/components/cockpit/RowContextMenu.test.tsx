import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';

describe('RowContextMenu', () => {
  it('renders nothing when coordinates are missing', () => {
    const { container } = render(
      <RowContextMenu clientX={null} clientY={null} items={[]} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the title row when title is provided', () => {
    render(
      <RowContextMenu
        clientX={10}
        clientY={20}
        title="Row menu"
        items={[{ label: 'Edit', onClick: vi.fn() }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Row menu')).toBeInTheDocument();
  });

  it('renders one button per item and invokes the handler + closes on click', () => {
    const editClick = vi.fn();
    const onClose = vi.fn();
    render(
      <RowContextMenu
        clientX={5}
        clientY={5}
        items={[{ label: 'Edit', onClick: editClick }]}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(editClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies the danger class to danger items', () => {
    render(
      <RowContextMenu
        clientX={0}
        clientY={0}
        items={[{ label: 'Delete', onClick: vi.fn(), danger: true }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('text-error');
  });

  it('disables the button when item.disabled is true', () => {
    render(
      <RowContextMenu
        clientX={0}
        clientY={0}
        items={[{ label: 'Nope', onClick: vi.fn(), disabled: true }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Nope' })).toBeDisabled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <RowContextMenu
        clientX={0}
        clientY={0}
        items={[{ label: 'X', onClick: vi.fn() }]}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('positions the menu at the given clientX/clientY', () => {
    const { container } = render(
      <RowContextMenu
        clientX={100}
        clientY={250}
        items={[{ label: 'X', onClick: vi.fn() }]}
        onClose={vi.fn()}
      />
    );
    const ul = container.querySelector('ul') as HTMLElement;
    expect(ul.style.top).toBe('250px');
    expect(ul.style.left).toBe('100px');
  });

  it('adds a separator on items marked separatorAfter', () => {
    const items: ContextMenuItem[] = [
      { label: 'A', onClick: vi.fn(), separatorAfter: true },
      { label: 'B', onClick: vi.fn() },
    ];
    const { container } = render(
      <RowContextMenu clientX={0} clientY={0} items={items} onClose={vi.fn()} />
    );
    const lis = container.querySelectorAll('li');
    // First data row (index 0) should have the border class; second not.
    expect(lis[0].className).toContain('border-b');
  });
});
