import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoPoll } from './useAutoPoll';

describe('useAutoPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback on every interval tick', () => {
    const fn = vi.fn();
    renderHook(() => useAutoPoll(fn, 25));
    expect(fn).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(25_000); });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(50_000); });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not fire when disabled', () => {
    const fn = vi.fn();
    renderHook(() => useAutoPoll(fn, 5, false));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not fire when intervalSec <= 0', () => {
    const fn = vi.fn();
    renderHook(() => useAutoPoll(fn, 0));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs the callback immediately when runImmediately is true', () => {
    const fn = vi.fn();
    renderHook(() => useAutoPoll(fn, 25, true, true));
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(25_000); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the timer on unmount', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useAutoPoll(fn, 5));
    unmount();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(fn).not.toHaveBeenCalled();
  });

  it('resets the timer when intervalSec changes', () => {
    const fn = vi.fn();
    const { rerender } = renderHook(({ interval }: { interval: number }) =>
      useAutoPoll(fn, interval), { initialProps: { interval: 10 } });
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(fn).not.toHaveBeenCalled();
    rerender({ interval: 20 });
    // Old timer cleared; new interval starts fresh.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(fn).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resumes polling when enabled flips from false to true', () => {
    const fn = vi.fn();
    const { rerender } = renderHook(({ enabled }: { enabled: boolean }) =>
      useAutoPoll(fn, 5, enabled), { initialProps: { enabled: false } });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(fn).not.toHaveBeenCalled();
    rerender({ enabled: true });
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('always invokes the latest callback (ref pattern)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) =>
      useAutoPoll(cb, 5), { initialProps: { cb: first } });
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ cb: second });
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
