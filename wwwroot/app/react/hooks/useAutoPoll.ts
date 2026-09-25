import { useEffect, useRef } from 'react';

// Route Viewer auto-poll hook. Home + Mobile modules refresh their run list
// every 25s per master Section 6; CS / Print / Linehaul / Scans are
// manual-only (operator hits Refresh) so they do NOT call this. Cancel is
// automatic on unmount + when `enabled` flips false.
//
// The callback runs on a leading-edge invisible tick too: consumers already
// fire an initial fetch on mount, so this hook only owns the recurring
// tick. Pass `runImmediately: true` if you want it to fire once on mount
// alongside the recurring cadence.
//
// Interval reset semantics: when `intervalSec` or `enabled` changes, we
// clear the existing timer and start a fresh one at the top of the new
// interval - matching the legacy $interval reset behaviour.
export function useAutoPoll(
  callback: () => void,
  intervalSec: number,
  enabled: boolean = true,
  runImmediately: boolean = false,
) {
  // Callback ref so the timer keeps firing the *latest* closure without
  // re-arming on every parent render.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled || intervalSec <= 0) return;
    if (runImmediately) cbRef.current();
    const id = window.setInterval(() => cbRef.current(), intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [intervalSec, enabled, runImmediately]);
}
