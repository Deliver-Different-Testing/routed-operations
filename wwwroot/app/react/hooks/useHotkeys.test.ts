import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHotkeys } from './useHotkeys';

function fireKey(init: KeyboardEventInit & { target?: EventTarget }) {
  const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.target) {
    // KeyboardEvent target is read-only via constructor, so dispatch from the
    // desired element and let bubbling reach document.
    (init.target as EventTarget).dispatchEvent(evt);
  } else {
    document.dispatchEvent(evt);
  }
  return evt;
}

describe('useHotkeys', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('registers a keydown listener on mount and removes it on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useHotkeys({}));
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('fires onEscape on Escape', () => {
    const onEscape = vi.fn();
    renderHook(() => useHotkeys({ onEscape }));
    const evt = fireKey({ key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('fires onEscape even when an input is focused (Esc dismisses modals from inside forms)', () => {
    const onEscape = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useHotkeys({ onEscape }));
    fireKey({ key: 'Escape', target: input });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('fires onDispatch on Ctrl+D', () => {
    const onDispatch = vi.fn();
    renderHook(() => useHotkeys({ onDispatch }));
    const evt = fireKey({ key: 'd', ctrlKey: true });
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('fires onDispatch on Meta+D (Mac)', () => {
    const onDispatch = vi.fn();
    renderHook(() => useHotkeys({ onDispatch }));
    fireKey({ key: 'D', metaKey: true });
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it('fires onSelectAll on Ctrl+A', () => {
    const onSelectAll = vi.fn();
    renderHook(() => useHotkeys({ onSelectAll }));
    const evt = fireKey({ key: 'a', ctrlKey: true });
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('fires onDelete on Delete key', () => {
    const onDelete = vi.fn();
    renderHook(() => useHotkeys({ onDelete }));
    fireKey({ key: 'Delete' });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('fires onDelete on Backspace key', () => {
    const onDelete = vi.fn();
    renderHook(() => useHotkeys({ onDelete }));
    fireKey({ key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('fires onEnter on Enter when not editing', () => {
    const onEnter = vi.fn();
    renderHook(() => useHotkeys({ onEnter }));
    fireKey({ key: 'Enter' });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('fires onArrowUp / onArrowDown when not editing', () => {
    const onArrowUp = vi.fn();
    const onArrowDown = vi.fn();
    renderHook(() => useHotkeys({ onArrowUp, onArrowDown }));
    fireKey({ key: 'ArrowUp' });
    fireKey({ key: 'ArrowDown' });
    expect(onArrowUp).toHaveBeenCalledTimes(1);
    expect(onArrowDown).toHaveBeenCalledTimes(1);
  });

  it('suppresses non-Esc shortcuts when the target is an INPUT', () => {
    const onDispatch = vi.fn();
    const onSelectAll = vi.fn();
    const onDelete = vi.fn();
    const onEnter = vi.fn();
    const onArrowUp = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useHotkeys({ onDispatch, onSelectAll, onDelete, onEnter, onArrowUp }));
    fireKey({ key: 'd', ctrlKey: true, target: input });
    fireKey({ key: 'a', ctrlKey: true, target: input });
    fireKey({ key: 'Delete', target: input });
    fireKey({ key: 'Enter', target: input });
    fireKey({ key: 'ArrowUp', target: input });
    expect(onDispatch).not.toHaveBeenCalled();
    expect(onSelectAll).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onEnter).not.toHaveBeenCalled();
    expect(onArrowUp).not.toHaveBeenCalled();
  });

  it('suppresses non-Esc shortcuts when the target is TEXTAREA or SELECT', () => {
    const onDispatch = vi.fn();
    const ta = document.createElement('textarea');
    const sel = document.createElement('select');
    document.body.append(ta, sel);
    renderHook(() => useHotkeys({ onDispatch }));
    fireKey({ key: 'd', ctrlKey: true, target: ta });
    fireKey({ key: 'd', ctrlKey: true, target: sel });
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it('is a no-op when no handler is registered for a key (browser default preserved)', () => {
    renderHook(() => useHotkeys({}));
    const evt = fireKey({ key: 'd', ctrlKey: true });
    expect(evt.defaultPrevented).toBe(false);
  });

  it('always sees the latest bindings via the internal ref', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ handler }: { handler: () => void }) =>
      useHotkeys({ onDispatch: handler }), { initialProps: { handler: first } });
    fireKey({ key: 'd', ctrlKey: true });
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ handler: second });
    fireKey({ key: 'd', ctrlKey: true });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('does not preventDefault when target is an input and no matching handler is registered', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useHotkeys({}));
    const evt = fireKey({ key: 'd', ctrlKey: true, target: input });
    expect(evt.defaultPrevented).toBe(false);
  });
});
