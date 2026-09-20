/**
 * Performance utilities for handling large datasets
 */

/**
 * Process array in chunks to avoid blocking the UI
 */
export async function processInChunks<T, R>(
  items: T[],
  processor: (item: T) => R,
  options: {
    chunkSize?: number;
    onProgress?: (processed: number, total: number) => void;
    delayBetweenChunks?: number;
  } = {}
): Promise<R[]> {
  const { chunkSize = 100, onProgress, delayBetweenChunks = 0 } = options;
  const results: R[] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = chunk.map(processor);
    results.push(...chunkResults);

    onProgress?.(Math.min(i + chunkSize, items.length), items.length);

    if (delayBetweenChunks > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenChunks));
    }
  }

  return results;
}

/**
 * Debounce function for search/filter inputs
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Memoize expensive computations
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  keyResolver?: (...args: Parameters<T>) => string
): T {
  const cache = new Map<string, ReturnType<T>>();

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = keyResolver ? keyResolver(...args) : JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

/**
 * Virtual window for large lists - calculate visible items
 */
export function getVirtualWindow<T>(
  items: T[],
  options: {
    scrollTop: number;
    containerHeight: number;
    itemHeight: number;
    overscan?: number;
  }
): {
  visibleItems: T[];
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  offsetTop: number;
} {
  const { scrollTop, containerHeight, itemHeight, overscan = 3 } = options;
  const totalHeight = items.length * itemHeight;

  let startIndex = Math.floor(scrollTop / itemHeight) - overscan;
  startIndex = Math.max(0, startIndex);

  let endIndex = Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan;
  endIndex = Math.min(items.length, endIndex);

  return {
    visibleItems: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    totalHeight,
    offsetTop: startIndex * itemHeight,
  };
}

/**
 * Batch state updates to reduce re-renders
 */
export function batchUpdates(updates: (() => void)[]): void {
  // React 18+ automatically batches, but this helps with explicit batching
  updates.forEach(update => update());
}

/**
 * Memory-efficient map for large datasets
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}
