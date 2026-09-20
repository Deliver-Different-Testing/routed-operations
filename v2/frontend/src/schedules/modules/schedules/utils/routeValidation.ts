// src/modules/schedules/utils/routeValidation.ts
import type { ScheduleLeg } from '../types';

export interface RouteValidationError {
  type: 'error' | 'warning';
  message: string;
}

export function validateRoute(legs: ScheduleLeg[]): RouteValidationError[] {
  const errors: RouteValidationError[] = [];

  if (legs.length === 0) {
    errors.push({ type: 'warning', message: 'Route has no legs configured.' });
    return errors;
  }

  const sorted = [...legs].sort((a, b) => a.order - b.order);

  // Collection usually starts the operational route, but the builder should not block unusual freight flows.
  const collectionLegs = sorted.filter(l => l.config.type === 'collection');
  if (collectionLegs.length >= 1 && sorted[0].config.type !== 'collection') {
    errors.push({ type: 'warning', message: 'Collection leg should be the first leg in the route.' });
  }

  // Check: no linehaul without a runId (warning)
  const linehaulLegs = sorted.filter(l => l.config.type === 'linehaul');
  for (const lh of linehaulLegs) {
    if (lh.config.type === 'linehaul' && !lh.config.runId) {
      errors.push({ type: 'warning', message: 'Linehaul leg has no run selected.' });
    }
  }

  return errors;
}
