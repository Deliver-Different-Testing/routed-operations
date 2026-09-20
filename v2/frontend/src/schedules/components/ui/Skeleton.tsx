import { memo } from 'react';

/** Skeleton placeholder for loading states. */
export interface SkeletonProps {
  /** Width class (e.g. 'w-full', 'w-32'). @default 'w-full' */
  width?: string;
  /** Height class (e.g. 'h-4', 'h-10'). @default 'h-4' */
  height?: string;
  /** Make it circular. */
  circle?: boolean;
  /** Additional classes. */
  className?: string;
}

export const Skeleton = memo(({ width = 'w-full', height = 'h-4', circle = false, className = '' }: SkeletonProps) => (
  <div
    data-testid="skeleton"
    className={`animate-pulse bg-gray-200 ${circle ? 'rounded-full' : 'rounded'} ${width} ${height} ${className}`}
    aria-hidden="true"
  />
));
Skeleton.displayName = 'Skeleton';

/** Pre-built skeleton for table rows. */
export const TableSkeleton = memo(({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) => (
  <div data-testid="table-skeleton" className="space-y-3 p-4">
    {Array.from({ length: rows }, (_, r) => (
      <div key={r} className="flex gap-4">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} height="h-8" />
        ))}
      </div>
    ))}
  </div>
));
TableSkeleton.displayName = 'TableSkeleton';
