import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type Toast = { id: number; message: string; kind: 'info' | 'success' | 'warning' | 'error' };
type ToastKind = Toast['kind'];

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track outstanding auto-dismiss timers so unmount can cancel them. Without
  // this, a toast fired seconds before unmount fires setToasts after the tree
  // is gone - harmless in prod, but crashes jsdom in tests as an unhandled
  // ReferenceError which CI treats as a job failure.
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    const handle = setTimeout(() => {
      timers.current.delete(handle);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
    timers.current.add(handle);
  }, []);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  // Memoize the context value. Without this, every ToastProvider re-render
  // (triggered by the `toasts` state change from setToasts) creates a fresh
  // `{ show }` object. Consumers that pass `toast` into useCallback / useEffect
  // dep arrays then see it as "changed" on every render, which produced an
  // infinite fetch loop on BulkImport.tsx before this fix.
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded shadow-md text-white ${
              t.kind === 'error'
                ? 'bg-error'
                : t.kind === 'warning'
                ? 'bg-warning'
                : t.kind === 'success'
                ? 'bg-success'
                : 'bg-brand-purple'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
