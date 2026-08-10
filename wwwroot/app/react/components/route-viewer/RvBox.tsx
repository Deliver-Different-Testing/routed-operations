import type { ReactNode } from 'react';

// Standard chrome wrapper for a cockpit box: title bar + scrollable body.
// Sizing is owned by the surrounding react-resizable-panels Panel; RvBox
// stays presentational.
interface Props {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RvBox({ title, actions, children, className }: Props) {
  return (
    <div className={`h-full flex flex-col bg-surface-white border border-border rounded overflow-hidden ${className ?? ''}`}>
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border bg-surface-cream/60">
        <span className="text-xs font-semibold text-text-primary flex-1 truncate">{title}</span>
        {actions}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
