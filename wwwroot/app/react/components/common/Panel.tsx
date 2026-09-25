interface PanelProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Panel({ title, actions, children, className = '' }: PanelProps) {
  return (
    <div className={`flex flex-col h-full bg-surface-white border border-border rounded shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-light bg-surface-cream">
          {title && <h3 className="text-sm font-semibold text-text-primary">{title}</h3>}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
