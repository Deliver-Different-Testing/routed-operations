// src/components/ui/DayPills.tsx

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface DayPillsProps {
  days: Record<string, { enabled: boolean }>;
  size?: 'sm' | 'md';
}

export function DayPills({ days, size = 'md' }: DayPillsProps) {
  const sizeClasses = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-sm';

  return (
    <div className="flex items-center gap-1.5">
      {DAY_KEYS.map((key, i) => {
        const enabled = days[key]?.enabled ?? false;
        return (
          <span
            key={key}
            className={`inline-flex items-center justify-center rounded-full ${sizeClasses} ${
              enabled
                ? 'bg-brand-cyan text-white font-semibold'
                : 'bg-transparent text-text-muted border border-border'
            }`}
          >
            {DAY_LABELS[i]}
          </span>
        );
      })}
    </div>
  );
}
