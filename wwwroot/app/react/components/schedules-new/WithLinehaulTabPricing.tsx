import type { ReactNode } from 'react';
import { useLegPricedFromLinehaulTab, type LinehaulTabPricingInput } from '../../hooks/queries/useLinehaulTabPricing';

/**
 * UC #1115 spec v2 Part B 2. Renders `children(fromTab)`, where fromTab says a Linehaul tab
 * row prices the leg. A component, not a hook call, so the editors can use it per leg in a
 * list and only where they pass the schedule's clients.
 */
export function WithLinehaulTabPricing({ children, ...input }: LinehaulTabPricingInput & { children: (fromTab: boolean) => ReactNode }) {
  return <>{children(useLegPricedFromLinehaulTab(input))}</>;
}
