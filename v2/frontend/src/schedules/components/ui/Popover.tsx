// src/components/ui/Popover.tsx
import { useRef, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  maxHeight?: number;
}

export function Popover({ anchorRef, open, onClose, children, width = 400, maxHeight = 500 }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean }>({ x: 0, y: 0, above: false });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (!open) return;

    const update = () => {
      setIsMobile(window.innerWidth < 768);
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const above = spaceBelow < maxHeight + 16 && rect.top > spaceBelow;
      let x = rect.left + rect.width / 2 - width / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - width - 8));
      const y = above ? rect.top - 8 : rect.bottom + 8;
      setPos({ x, y, above });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, width, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  // Mobile: bottom sheet
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        <div className="bg-black/50 flex-1" onClick={onClose} />
        <div className="bg-white rounded-t-xl max-h-[80vh] overflow-y-auto">
          {children}
        </div>
      </div>,
      document.body
    );
  }

  // Desktop: positioned popover
  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={popoverRef}
        style={{
          position: 'fixed',
          top: pos.above ? undefined : pos.y,
          bottom: pos.above ? window.innerHeight - pos.y : undefined,
          left: pos.x,
          width,
        }}
        className="bg-white rounded-xl shadow-2xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ maxHeight }} className="overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
