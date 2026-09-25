import { useCallback, useState } from 'react';

// Sequential per-item action runner (Route Viewer P4, master Section F1
// / S.1). Legacy RunViewer fires bulk actions one at a time with a
// ~150ms sleep between calls to avoid stampeding the backend with 20+
// concurrent SP invocations. Explicitly NOT `Promise.all`.
//
// The 150ms gap is the biggest silent DDoS mitigation on the surface -
// removing it lets an operator hit "Bulk Missing" on 200 selected jobs
// and blow through the SP thread pool. If a future performance test
// justifies parallelism, do it inside the SP (batched IN clause) and
// only then relax this hook.
export interface BulkRunResult<T> {
  ok: T[];
  failed: Array<{ item: unknown; error: Error }>;
}

export function useSequentialBulkAction<TItem, TResult>() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  const run = useCallback(async (
    items: TItem[],
    fn: (item: TItem) => Promise<TResult>,
    gapMs: number = 150,
  ): Promise<BulkRunResult<TResult>> => {
    setRunning(true);
    setProgress({ done: 0, total: items.length });
    const ok: TResult[] = [];
    const failed: Array<{ item: unknown; error: Error }> = [];
    try {
      for (let i = 0; i < items.length; i++) {
        try {
          const r = await fn(items[i]);
          ok.push(r);
        } catch (e) {
          failed.push({ item: items[i], error: e as Error });
        }
        setProgress({ done: i + 1, total: items.length });
        if (i < items.length - 1 && gapMs > 0) {
          await new Promise((res) => setTimeout(res, gapMs));
        }
      }
      return { ok, failed };
    } finally {
      setRunning(false);
    }
  }, []);

  return { run, running, progress };
}
