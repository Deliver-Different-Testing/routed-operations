/**
 * Skeleton & TableSkeleton Usage Examples
 *
 * Use Skeleton as a placeholder while content loads.
 */
import { Skeleton, TableSkeleton } from './Skeleton';

/** Example 1: Text line placeholders */
export function TextSkeletonExample() {
  return (
    <div className="space-y-2 w-64">
      <Skeleton height="h-6" width="w-3/4" />
      <Skeleton height="h-4" />
      <Skeleton height="h-4" width="w-5/6" />
    </div>
  );
}

/** Example 2: Avatar circle */
export function AvatarSkeletonExample() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton circle width="w-10" height="h-10" />
      <div className="space-y-2 flex-1">
        <Skeleton height="h-4" width="w-32" />
        <Skeleton height="h-3" width="w-48" />
      </div>
    </div>
  );
}

/** Example 3: Table skeleton (common for data pages) */
export function TableSkeletonExample() {
  return <TableSkeleton rows={5} columns={4} />;
}

/** Example 4: Card skeleton */
export function CardSkeletonExample() {
  return (
    <div className="p-4 border rounded-lg space-y-3">
      <Skeleton height="h-6" width="w-1/2" />
      <Skeleton height="h-4" />
      <Skeleton height="h-4" width="w-3/4" />
      <Skeleton height="h-8" width="w-24" />
    </div>
  );
}
