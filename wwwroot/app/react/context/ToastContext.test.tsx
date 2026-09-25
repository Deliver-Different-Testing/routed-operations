import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContext';

describe('ToastContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ToastProvider renders its children', () => {
    render(
      <ToastProvider>
        <span data-testid="child">child body</span>
      </ToastProvider>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('child body');
  });

  it('useToast without a Provider returns a no-op show function', () => {
    const { result } = renderHook(() => useToast());
    expect(() => result.current.show('hello')).not.toThrow();
  });

  it('show() adds a toast to the DOM', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('Saved successfully');
    });
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
  });

  it('auto-removes a toast after 4000ms', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('bye soon');
    });
    expect(screen.getByText('bye soon')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('bye soon')).not.toBeInTheDocument();
  });

  it('renders info kind (default) with brand-purple background', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('info msg');
    });
    const node = screen.getByText('info msg');
    expect(node.className).toContain('bg-brand-purple');
  });

  it('renders success kind with bg-success class', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('ok', 'success');
    });
    expect(screen.getByText('ok').className).toContain('bg-success');
  });

  it('renders warning kind with bg-warning class', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('careful', 'warning');
    });
    expect(screen.getByText('careful').className).toContain('bg-warning');
  });

  it('renders error kind with bg-error class', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('nope', 'error');
    });
    expect(screen.getByText('nope').className).toContain('bg-error');
  });

  it('stacks multiple toasts and removes them independently', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('first');
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      result.current.show('second');
    });
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('first')).not.toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('second')).not.toBeInTheDocument();
  });

  it('returns a memoized api object across renders', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result, rerender } = renderHook(() => useToast(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
