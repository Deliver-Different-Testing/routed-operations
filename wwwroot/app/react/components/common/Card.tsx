interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`bg-surface-white border border-border rounded shadow-sm p-4 ${className}`}>
      {title && <h2 className="text-base font-semibold text-text-primary mb-3">{title}</h2>}
      {children}
    </div>
  );
}
