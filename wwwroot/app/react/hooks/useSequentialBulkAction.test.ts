import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSequentialBulkAction } from './useSequentialBulkAction';

describe('useSequentialBulkAction', () => {
  it('initialises with running=false and zeroed progress', () => {
    const { result } = renderHook(() => useSequentialBulkAction<number, string>());
    expect(result.current.running).toBe(false);
    expect(result.current.progress).toEqual({ done: 0, total: 0 });
    expect(typeof result.current.run).toBe('function');
  });

  it('returns { ok: [], failed: [] } for an empty input list', async () => {
    const { result } = renderHook(() => useSequentialBulkAction<number, string>());
    const fn = vi.fn(async (n: number) => `v${n}`);
    let out!: Awaited<ReturnType<typeof result.current.run>>;
    await act(async () => {
      out = await result.current.run([], fn, 0);
    });
    expect(fn).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: [], failed: [] });
    expect(result.current.running).toBe(false);
  });

  describe('with fake timers', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('runs items sequentially (not in parallel) with the 150ms default gap between them', async () => {
      const { result } = renderHook(() => useSequentialBulkAction<number, string>());
      const started: number[] = [];
      const finished: number[] = [];
      const fn = vi.fn(async (n: number) => {
        started.push(n);
        // Immediate resolution simulates a fast SP call; the between-item
        // 150ms sleep is the load-bearing wait we test explicitly.
        finished.push(n);
        return `v${n}`;
      });
      let done: Awaited<ReturnType<typeof result.current.run>> | undefined;
      act(() => {
        result.current.run([1, 2, 3], fn).then((r) => { done = r; });
      });
      // Let the first item resolve.
      await act(async () => { await Promise.resolve(); });
      expect(fn).toHaveBeenCalledTimes(1);
      // Advance past the 150ms gap to the next item.
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      expect(fn).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      expect(fn).toHaveBeenCalledTimes(3);
      // Drain the final resolution.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(done).toEqual({ ok: ['v1', 'v2', 'v3'], failed: [] });
      expect(started).toEqual([1, 2, 3]);
      expect(finished).toEqual([1, 2, 3]);
    });

    it('honours a caller-supplied gapMs', async () => {
      const { result } = renderHook(() => useSequentialBulkAction<number, string>());
      const fn = vi.fn(async (n: number) => `v${n}`);
      act(() => { void result.current.run([1, 2], fn, 500); });
      await act(async () => { await Promise.resolve(); });
      expect(fn).toHaveBeenCalledTimes(1);
      // Not yet - only 150ms of the 500ms have elapsed.
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      expect(fn).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('skips the inter-item sleep when gapMs is 0', async () => {
      const { result } = renderHook(() => useSequentialBulkAction<number, string>());
      const fn = vi.fn(async (n: number) => `v${n}`);
      let out: Awaited<ReturnType<typeof result.current.run>> | undefined;
      await act(async () => {
        out = await result.current.run([1, 2, 3], fn, 0);
      });
      expect(fn).toHaveBeenCalledTimes(3);
      expect(out?.ok).toEqual(['v1', 'v2', 'v3']);
    });
  });

  it('updates progress after each item completes', async () => {
    const { result } = renderHook(() => useSequentialBulkAction<number, string>());
    const fn = vi.fn(async (n: number) => `v${n}`);
    await act(async () => {
      await result.current.run([1, 2, 3], fn, 0);
    });
    expect(result.current.progress).toEqual({ done: 3, total: 3 });
    expect(result.current.running).toBe(false);
  });

  it('collects thrown errors in `failed` and keeps processing the remaining items', async () => {
    const { result } = renderHook(() => useSequentialBulkAction<number, string>());
    const err = new Error('boom');
    const fn = vi.fn(async (n: number) => {
      if (n === 2) throw err;
      return `v${n}`;
    });
    let out: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      out = await result.current.run([1, 2, 3], fn, 0);
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(out?.ok).toEqual(['v1', 'v3']);
    expect(out?.failed).toEqual([{ item: 2, error: err }]);
  });

  it('sets running=true while running and back to false after completion', async () => {
    const { result } = renderHook(() => useSequentialBulkAction<number, string>());
    let resolveFirst!: (v: string) => void;
    const fn = vi.fn((n: number) =>
      n === 1
        ? new Promise<string>((r) => { resolveFirst = r; })
        : Promise.resolve(`v${n}`));
    let done!: Promise<unknown>;
    act(() => { done = result.current.run([1, 2], fn, 0); });
    await waitFor(() => expect(result.current.running).toBe(true));
    resolveFirst('v1');
    await act(async () => { await done; });
    expect(result.current.running).toBe(false);
  });
});
