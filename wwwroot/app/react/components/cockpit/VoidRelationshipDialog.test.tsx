import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoidRelationshipDialog } from './VoidRelationshipDialog';

function makeContext(overrides: any = {}) {
  return {
    selectedIds: [1, 2],
    expandedIds: [1, 2, 3, 4],
    isVoid: true,
    jobNumbersById: new Map([[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D']]),
    ...overrides,
  };
}

describe('VoidRelationshipDialog', () => {
  it('renders nothing when context is null', () => {
    const { container } = render(
      <VoidRelationshipDialog context={null} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the Void verb header when isVoid=true', () => {
    render(
      <VoidRelationshipDialog context={makeContext()} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByRole('heading', { name: 'Void multibox family?' })).toBeInTheDocument();
  });

  it('renders the Un-void verb header when isVoid=false', () => {
    render(
      <VoidRelationshipDialog
        context={makeContext({ isVoid: false })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Un-void multibox family?' })).toBeInTheDocument();
  });

  it('lists the selected and sibling job numbers', () => {
    render(
      <VoidRelationshipDialog context={makeContext()} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText('A, B')).toBeInTheDocument();
    expect(screen.getByText('C, D')).toBeInTheDocument();
  });

  it('confirms with the selected ids only when the selected-only button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <VoidRelationshipDialog context={makeContext()} onConfirm={onConfirm} onCancel={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Void 2 selected only/ }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2]);
  });

  it('confirms with the expanded ids when the full-family button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <VoidRelationshipDialog context={makeContext()} onConfirm={onConfirm} onCancel={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Void full family \(4\)/ }));
    expect(onConfirm).toHaveBeenCalledWith([1, 2, 3, 4]);
  });

  it('fires onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <VoidRelationshipDialog context={makeContext()} onConfirm={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('falls back to job id when a job number is missing from the map', () => {
    render(
      <VoidRelationshipDialog
        context={makeContext({ jobNumbersById: new Map([[1, 'A']]) })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('A, 2')).toBeInTheDocument();
  });
});
