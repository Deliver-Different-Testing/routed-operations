// Final-mile tote scanning switch in the Route editor (final-mile route setup
// spec 3.2). A final-mile route either uses tote scanning, and then needs a
// master job, or it does not, and then each delivery is its own job like any
// other recurring route. These are the save rules for that switch, kept out of
// the component so they can be tested without rendering the editor.

import type { FinalMileDeliveryModeValue } from '../services/recurringRouteService';

export const TOTE_NEEDS_MASTER_MESSAGE = 'Pick a master job, or turn tote scanning off.';

/** The switch opens on for an existing route that already has a master, and
 *  off for a new route or a route without one (spec 3.2.1). */
export function initialToteScanning(initialMasterBookingId: number | null | undefined): boolean {
  return (initialMasterBookingId ?? 0) > 0;
}

export interface ToteSaveInput {
  toteScanning: boolean;
  /** The master currently picked in the editor. */
  masterBookingId: number | null;
  /** The master the route had when the editor opened. */
  initialMasterBookingId: number | null | undefined;
  initialMasterLabel: string | null | undefined;
}

export type ToteSaveCheck =
  | { kind: 'ok' }
  | { kind: 'refuse'; message: string }
  | { kind: 'confirm'; message: string };

/** What Save must do before it sends a final-mile route.
 *
 *  - Switch on with no master: refused. This is the only place a master is
 *    required, and only because the user asked for tote scanning (3.2.4).
 *  - Switch off on a route that had a master: ask first, because the save
 *    unbinds that booking (3.2.5).
 *  - Anything else saves without a word. A route with no master never gets a
 *    warning (3.1). */
export function checkToteSave(input: ToteSaveInput): ToteSaveCheck {
  if (input.toteScanning) {
    return input.masterBookingId == null
      ? { kind: 'refuse', message: TOTE_NEEDS_MASTER_MESSAGE }
      : { kind: 'ok' };
  }
  if (initialToteScanning(input.initialMasterBookingId)) {
    const label = input.initialMasterLabel || `#${input.initialMasterBookingId}`;
    return {
      kind: 'confirm',
      message: `Turning this off unbinds booking ${label} from this route.`,
    };
  }
  return { kind: 'ok' };
}

/** The master fields a final-mile save sends. Switch off sends 0, the
 *  existing explicit clear, so a route that had a master loses it and a route
 *  that never had one is left as it is (the server demotes nothing). */
export function toteSavePayload(
  toteScanning: boolean,
  masterBookingId: number | null,
  deliveryMode: FinalMileDeliveryModeValue,
): { masterBookingId: number; finalMileDeliveryMode: FinalMileDeliveryModeValue | null } {
  if (!toteScanning || masterBookingId == null) {
    return { masterBookingId: 0, finalMileDeliveryMode: null };
  }
  return { masterBookingId, finalMileDeliveryMode: deliveryMode };
}
