import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dropdown panel rendered into document.body, positioned against an
 * anchor element.
 *
 * Why this exists. Every picker in Schedules NEW used to render its panel
 * as an absolutely-positioned sibling of its trigger. That works on a
 * page, and breaks inside a modal: Modal's body is
 * `overflow-auto flex-1`, so a panel taller than the remaining space is
 * clipped at the modal edge and the options below the fold cannot be
 * reached at all. The first report was the bundle modal's two pickers;
 * ClientMultiPicker alone is used inside four different modals, so the
 * one-line raise-the-z-index fix would have had to be repeated and would
 * not have helped anyway, because clipping comes from `overflow`, not
 * from stacking order.
 *
 * What it handles, each of which was a real failure mode of the previous
 * markup:
 *
 *   * Clipping - the panel is a child of body, so no ancestor's overflow
 *     applies to it.
 *   * Stacking - fixed z-index 60, above Modal's z-40 backdrop. A plain
 *     `z-50` inside the modal is in the modal's stacking context and
 *     cannot escape it.
 *   * Flip - opens upward when there is less room below than the panel
 *     needs, so a trigger near the bottom of the viewport still shows its
 *     options.
 *   * Follow - re-measures on scroll (capture phase, so it catches the
 *     modal body's own scrolling, not just the window's) and on resize.
 *     Without capture the panel detaches from its trigger the moment the
 *     operator scrolls the modal.
 *   * Dismissal - one mousedown/Escape listener here rather than one per
 *     picker, and it treats BOTH the anchor and the portaled panel as
 *     inside. A naive `wrapperRef.contains(e.target)` check closes the
 *     panel the instant it is clicked, because the panel is no longer a
 *     DOM descendant of the wrapper.
 */
interface Props {
  /** The element the panel is positioned against (usually the trigger). */
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  /** Called on Escape, or on a mousedown outside both anchor and panel. */
  onDismiss: () => void;
  children: React.ReactNode;
  /** Panel width. 'anchor' matches the anchor's width; a number is px. */
  width?: 'anchor' | number;
  /** Horizontal edge to align to. Defaults to the anchor's left. */
  align?: 'left' | 'right';
  /** Space in px between anchor and panel. */
  gap?: number;
  /** Passed through for tests and E2E selectors. */
  'data-testid'?: string;
}

interface Pos {
  /** Set when the panel hangs DOWN from the anchor. */
  top?: number;
  /** Set when the panel is flipped UP. Pinning the bottom edge rather than
   *  computing a top from the panel's height is what keeps a flipped panel
   *  attached to its trigger while its content changes size - a searchable
   *  list shrinking from 50 rows to 4 otherwise left the panel stranded
   *  near the top of the screen, ~900px above the trigger it belonged to. */
  bottom?: number;
  left: number;
  width: number;
  /** Max height the panel may use before it should scroll internally. */
  maxHeight: number;
}

/** Keep the panel this far from the viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Below this, flipping up is better than scrolling a sliver. */
const MIN_SPACE = 160;

export function DropdownPortal({
  anchorRef,
  open,
  onDismiss,
  children,
  width = 'anchor',
  align = 'left',
  gap = 4,
  'data-testid': testId,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    // Not measurable yet. React attaches host refs bottom-up, so when a
    // panel mounts in the SAME commit as its anchor (a picker that is
    // rendered already-open rather than toggled open by a later click),
    // this child's layout effect runs BEFORE the parent div's ref is
    // assigned and the anchor is still null. Returning without retrying
    // left such a panel invisible forever, because nothing else triggers
    // a re-measure until a scroll or resize. Caught by the bundle
    // modal's schedule picker, which mounts open.
    if (!anchor) return false;
    const r = anchor.getBoundingClientRect();
    const panelWidth = width === 'anchor' ? r.width : width;
    const below = window.innerHeight - r.bottom - gap - VIEWPORT_MARGIN;
    const above = r.top - gap - VIEWPORT_MARGIN;
    // Flip only when below is genuinely too tight AND above is better, so
    // a short panel near the bottom does not jump upward for no reason.
    const flip = below < MIN_SPACE && above > below;
    const maxHeight = Math.max(MIN_SPACE, flip ? above : below);

    let left = align === 'right' ? r.right - panelWidth : r.left;
    // Clamp inside the viewport. A right-aligned panel on a narrow screen
    // would otherwise sit off-screen with no way to scroll to it.
    left = Math.min(left, window.innerWidth - panelWidth - VIEWPORT_MARGIN);
    left = Math.max(VIEWPORT_MARGIN, left);

    const next: Pos = flip
      ? { bottom: window.innerHeight - r.top + gap, left, width: panelWidth, maxHeight }
      : { top: r.bottom + gap, left, width: panelWidth, maxHeight };
    // Keep the previous object when nothing moved. Scroll fires this
    // constantly, and a fresh object every time would re-render the whole
    // panel on each event.
    setPos((prev) => (prev
      && prev.top === next.top && prev.bottom === next.bottom
      && prev.left === next.left && prev.width === next.width
      && prev.maxHeight === next.maxHeight) ? prev : next);
    return true;
  }, [anchorRef, width, align, gap]);

  // Measure before paint so the panel never shows at the wrong place for
  // a frame.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
  }, [open, measure]);

  // Second attempt, for the case measure() documents: a panel mounting in
  // the same commit as its anchor sees a null ref in the layout phase.
  // Passive effects run after the whole tree's refs are attached, so this
  // always has an anchor, and it costs one no-op measure otherwise
  // (the equality check above makes it free).
  useEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => measure();
    // Capture, so an ancestor scroller (the modal body) is caught too.
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stop Modal's own Escape handler from closing the whole modal when
      // the operator only meant to dismiss the dropdown.
      e.stopPropagation();
      onDismiss();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onDismiss, anchorRef]);

  if (!open || pos == null) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-testid={testId}
      data-dropdown-portal="true"
      style={{
        position: 'fixed',
        // Exactly one of these is set; see Pos.
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        zIndex: 60,
      }}
      className="bg-surface-white border border-border rounded shadow-lg overflow-hidden flex flex-col"
    >
      {children}
    </div>,
    document.body,
  );
}
