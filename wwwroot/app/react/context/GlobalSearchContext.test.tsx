import { describe, expect, it, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import {
  GlobalSearchProvider,
  useGlobalSearch,
  type SearchHit,
} from './GlobalSearchContext';

const sampleHit: SearchHit = {
  bulkJobId: 42,
  jobNumber: 'JN-1',
  clientCode: 'ACME',
  toSuburb: 'Auckland',
  toPostCode: 1010,
  runName: 'RunA',
};

describe('GlobalSearchContext', () => {
  it('GlobalSearchProvider renders its children', () => {
    render(
      <GlobalSearchProvider>
        <span data-testid="kid">yo</span>
      </GlobalSearchProvider>
    );
    expect(screen.getByTestId('kid')).toHaveTextContent('yo');
  });

  it('exposes initial defaults (empty query, empty results)', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
  });

  it('setQuery updates the query value', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    act(() => {
      result.current.setQuery('ACME');
    });
    expect(result.current.query).toBe('ACME');
  });

  it('publishResults stores hits and clears when passed an empty array', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    act(() => {
      result.current.publishResults([sampleHit]);
    });
    expect(result.current.results).toEqual([sampleHit]);
    act(() => {
      result.current.publishResults([]);
    });
    expect(result.current.results).toEqual([]);
  });

  it('jumpToJob invokes the registered handler with the bulkJobId', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    const jump = vi.fn();
    act(() => {
      result.current.registerOnJump(jump);
    });
    act(() => {
      result.current.jumpToJob(99);
    });
    expect(jump).toHaveBeenCalledWith(99);
  });

  it('jumpToJob is a no-op when no handler is registered', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    expect(() => {
      act(() => {
        result.current.jumpToJob(1);
      });
    }).not.toThrow();
  });

  it('registerOnJump(null) unregisters the previous handler', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    const jump = vi.fn();
    act(() => {
      result.current.registerOnJump(jump);
    });
    act(() => {
      result.current.registerOnJump(null);
    });
    act(() => {
      result.current.jumpToJob(5);
    });
    expect(jump).not.toHaveBeenCalled();
  });

  it('last registered handler wins', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      result.current.registerOnJump(first);
    });
    act(() => {
      result.current.registerOnJump(second);
    });
    act(() => {
      result.current.jumpToJob(12);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(12);
  });

  it('useGlobalSearch without a Provider returns safe no-op defaults', () => {
    const { result } = renderHook(() => useGlobalSearch());
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(() => result.current.setQuery('x')).not.toThrow();
    expect(() => result.current.publishResults([sampleHit])).not.toThrow();
    expect(() => result.current.registerOnJump(vi.fn())).not.toThrow();
    expect(() => result.current.jumpToJob(1)).not.toThrow();
  });

  it('registerOnJump and jumpToJob references stay stable when query changes', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalSearchProvider>{children}</GlobalSearchProvider>
    );
    const { result } = renderHook(() => useGlobalSearch(), { wrapper });
    const registerBefore = result.current.registerOnJump;
    const jumpBefore = result.current.jumpToJob;
    const publishBefore = result.current.publishResults;
    act(() => {
      result.current.setQuery('changing');
    });
    expect(result.current.registerOnJump).toBe(registerBefore);
    expect(result.current.jumpToJob).toBe(jumpBefore);
    expect(result.current.publishResults).toBe(publishBefore);
  });
});
