import { describe, expect, it } from 'vitest';
import { render, screen, renderHook, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, useConfirm, useAlert } from './ConfirmContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConfirmProvider>{children}</ConfirmProvider>
);

describe('ConfirmContext', () => {
  it('ConfirmProvider renders its children', () => {
    render(
      <ConfirmProvider>
        <span data-testid="child">c</span>
      </ConfirmProvider>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('c');
  });

  it('useConfirm without a Provider resolves false by default', async () => {
    const { result } = renderHook(() => useConfirm());
    await expect(result.current('anything')).resolves.toBe(false);
  });

  it('useAlert without a Provider resolves undefined by default', async () => {
    const { result } = renderHook(() => useAlert());
    await expect(result.current('anything')).resolves.toBeUndefined();
  });

  it('confirm(string) opens a modal with default title and default labels', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current('Are you sure?');
    });
    expect(await screen.findByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(promise).resolves.toBe(false);
  });

  it('confirm resolves true when the primary button is clicked', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current({
        message: 'Proceed?',
        confirmLabel: 'Yes',
        cancelLabel: 'No',
      });
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await expect(promise).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByText('Proceed?')).not.toBeInTheDocument());
  });

  it('confirm resolves false when the Cancel button is clicked', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current({
        message: 'Discard?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep',
      });
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Keep' }));
    await expect(promise).resolves.toBe(false);
  });

  it('confirm resolves false when the X close button is clicked', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current('Bye?');
    });
    await screen.findByText('Bye?');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await expect(promise).resolves.toBe(false);
  });

  it('confirm resolves false when the backdrop is clicked', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current('Click outside?');
    });
    await screen.findByText('Click outside?');
    const backdrop = document.querySelector('[data-modal-open="true"]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    const user = userEvent.setup();
    await user.click(backdrop);
    await expect(promise).resolves.toBe(false);
  });

  it('confirm with danger:true renders the primary button in the danger variant', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    act(() => {
      result.current({
        message: 'Delete forever?',
        confirmLabel: 'Delete',
        danger: true,
      });
    });
    const primary = await screen.findByRole('button', { name: 'Delete' });
    expect(primary.className).toContain('border-error');
  });

  it('confirm without danger renders the primary button in the secondary variant', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    act(() => {
      result.current({ message: 'Save?', confirmLabel: 'Save' });
    });
    const primary = await screen.findByRole('button', { name: 'Save' });
    expect(primary.className).not.toContain('border-error');
  });

  it('confirm honours a custom title', async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    act(() => {
      result.current({ message: 'x', title: 'Delete route' });
    });
    expect(await screen.findByRole('heading', { name: 'Delete route' })).toBeInTheDocument();
  });

  it('alert(string) opens a Notice modal with an OK button and resolves on click', async () => {
    const { result } = renderHook(() => useAlert(), { wrapper });
    let promise!: Promise<void>;
    act(() => {
      promise = result.current('Something happened');
    });
    expect(await screen.findByText('Something happened')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notice' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await expect(promise).resolves.toBeUndefined();
    await waitFor(() =>
      expect(screen.queryByText('Something happened')).not.toBeInTheDocument()
    );
  });

  it('alert honours custom title and okLabel', async () => {
    const { result } = renderHook(() => useAlert(), { wrapper });
    act(() => {
      result.current({ message: 'oops', title: 'Warning', okLabel: 'Got it' });
    });
    expect(await screen.findByRole('heading', { name: 'Warning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('alert resolves when the backdrop is clicked', async () => {
    const { result } = renderHook(() => useAlert(), { wrapper });
    let promise!: Promise<void>;
    act(() => {
      promise = result.current('Backdrop close?');
    });
    await screen.findByText('Backdrop close?');
    const backdrop = document.querySelector('[data-modal-open="true"]') as HTMLElement;
    const user = userEvent.setup();
    await user.click(backdrop);
    await expect(promise).resolves.toBeUndefined();
  });

  it('firing a second confirm while one is pending cancels the first with false', async () => {
    function Both() {
      const confirm = useConfirm();
      return (
        <>
          <button type="button" onClick={() => (window as any).__first = confirm('First?')}>
            first
          </button>
          <button type="button" onClick={() => (window as any).__second = confirm('Second?')}>
            second
          </button>
        </>
      );
    }
    render(
      <ConfirmProvider>
        <Both />
      </ConfirmProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByText('First?');
    await user.click(screen.getByRole('button', { name: 'second' }));
    await screen.findByText('Second?');
    await expect((window as any).__first as Promise<boolean>).resolves.toBe(false);
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await expect((window as any).__second as Promise<boolean>).resolves.toBe(true);
  });

  it('firing an alert while a confirm is pending cancels the confirm with false', async () => {
    function Both() {
      const confirm = useConfirm();
      const alert = useAlert();
      return (
        <>
          <button type="button" onClick={() => (window as any).__c = confirm('Are you?')}>
            open-confirm
          </button>
          <button type="button" onClick={() => (window as any).__a = alert('FYI')}>
            open-alert
          </button>
        </>
      );
    }
    render(
      <ConfirmProvider>
        <Both />
      </ConfirmProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open-confirm' }));
    await screen.findByText('Are you?');
    await user.click(screen.getByRole('button', { name: 'open-alert' }));
    await screen.findByText('FYI');
    await expect((window as any).__c as Promise<boolean>).resolves.toBe(false);
  });
});
