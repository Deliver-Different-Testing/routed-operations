import { useRef, useState } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DropdownPortal } from './DropdownPortal';

/**
 * Both of the behaviours pinned here were real bugs, found by driving the
 * browser rather than by reading the code, and both failed SILENTLY: the
 * panel was present in the DOM and the component threw nothing. A unit
 * test is worth having precisely because neither would ever turn a test
 * red by itself.
 */

// jsdom gives every element a zero rect, so anchors have to be faked.
function stubRect(el: HTMLElement, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}), ...rect,
  }) as DOMRect;
}

beforeEach(() => {
  // A tall-enough viewport so "flip" is a decision rather than a default.
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('DropdownPortal', () => {
  it('renders the panel into document.body, not inside its parent', () => {
    // The whole point. An absolutely-positioned sibling is clipped by any
    // ancestor with overflow (Modal's body is overflow-auto), and no
    // z-index can escape that - it is clipping, not stacking.
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div data-testid="clipper" style={{ overflow: 'auto' }}>
          <div
            ref={(el) => { if (el) { ref.current = el; stubRect(el, { top: 100, bottom: 120, left: 50, width: 200 }); } }}
          >
            trigger
          </div>
          <DropdownPortal anchorRef={ref} open onDismiss={() => {}} data-testid="panel">
            <div>option</div>
          </DropdownPortal>
        </div>
      );
    }
    render(<Harness />);

    const panel = screen.getByTestId('panel');
    expect(panel.parentElement).toBe(document.body);
    expect(screen.getByTestId('clipper').contains(panel)).toBe(false);
  });

  it('appears when it mounts in the same commit as its anchor', () => {
    // REGRESSION. React attaches host refs bottom-up, so a panel rendered
    // already-open runs its layout effect BEFORE the parent div's ref is
    // assigned and measures a null anchor. Without a retry the panel never
    // rendered at all - which is how the bundle modal's schedule picker
    // showed an empty search box and no results, with nothing in the
    // console.
    function MountsOpen() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref}>
          <DropdownPortal anchorRef={ref} open onDismiss={() => {}} data-testid="panel">
            <div>option</div>
          </DropdownPortal>
        </div>
      );
    }
    render(<MountsOpen />);
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('pins a flipped panel by its BOTTOM so shrinking content stays attached', () => {
    // REGRESSION. Flipping used to set `top = anchorTop - panelHeight`,
    // computed from the height at open time. A searchable list going from
    // 50 rows to 4 then left the panel stranded ~900px above the trigger
    // it belonged to, still visible and still interactive, just nowhere
    // near the field. Pinning the bottom edge makes height irrelevant.
    function FlipHarness() {
      const ref = useRef<HTMLDivElement>(null);
      const [many, setMany] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setMany(false)}>shrink</button>
          <div
            ref={(el) => { if (el) { ref.current = el; stubRect(el, { top: 780, bottom: 795, left: 10, width: 200 }); } }}
          >
            trigger
          </div>
          <DropdownPortal anchorRef={ref} open onDismiss={() => {}} data-testid="panel">
            <div>{many ? 'fifty rows' : 'four rows'}</div>
          </DropdownPortal>
        </>
      );
    }
    render(<FlipHarness />);

    const panel = screen.getByTestId('panel');
    // Anchor bottom is 795 of an 800px viewport: there is no room below,
    // so it must have flipped.
    expect(panel.style.bottom).not.toBe('');
    expect(panel.style.top).toBe('');

    const before = panel.style.bottom;
    fireEvent.click(screen.getByRole('button', { name: 'shrink' }));
    // Same anchor, so the same pinned edge, regardless of content height.
    expect(screen.getByTestId('panel').style.bottom).toBe(before);
  });

  it('hangs down when there is room below', () => {
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div
          ref={(el) => { if (el) { ref.current = el; stubRect(el, { top: 40, bottom: 60, left: 10, width: 200 }); } }}
        >
          <DropdownPortal anchorRef={ref} open onDismiss={() => {}} gap={4} data-testid="panel">
            <div>option</div>
          </DropdownPortal>
        </div>
      );
    }
    render(<Harness />);

    const panel = screen.getByTestId('panel');
    expect(panel.style.top).toBe('64px');
    expect(panel.style.bottom).toBe('');
  });

  it('treats a click inside the portaled panel as inside, not outside', () => {
    // The trap when moving a panel out of its wrapper: the usual
    // `wrapperRef.contains(e.target)` check is false for the panel now, so
    // a naive dismiss handler closes the dropdown the instant an option is
    // clicked and the click never lands.
    const onDismiss = vi.fn();
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div
          ref={(el) => { if (el) { ref.current = el; stubRect(el, { top: 40, bottom: 60, left: 10, width: 200 }); } }}
        >
          <DropdownPortal anchorRef={ref} open onDismiss={onDismiss} data-testid="panel">
            <button type="button">option</button>
          </DropdownPortal>
        </div>
      );
    }
    render(<Harness />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'option' }));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stops Escape from reaching an enclosing modal', () => {
    // Escape inside an open dropdown means "close the dropdown". Letting
    // it bubble closes the whole modal and discards the operator's input.
    const onDismiss = vi.fn();
    const modalEscape = vi.fn();
    document.addEventListener('keydown', modalEscape);
    try {
      function Harness() {
        const ref = useRef<HTMLDivElement>(null);
        return (
          <div
            ref={(el) => { if (el) { ref.current = el; stubRect(el, { top: 40, bottom: 60, left: 10, width: 200 }); } }}
          >
            <DropdownPortal anchorRef={ref} open onDismiss={onDismiss} data-testid="panel">
              <div>option</div>
            </DropdownPortal>
          </div>
        );
      }
      render(<Harness />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      // The portal listens in the CAPTURE phase and stops propagation, so
      // a bubble-phase listener (Modal's) never sees it.
      expect(modalEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', modalEscape);
    }
  });

  it('renders nothing while closed', () => {
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref}>
          <DropdownPortal anchorRef={ref} open={false} onDismiss={() => {}} data-testid="panel">
            <div>option</div>
          </DropdownPortal>
        </div>
      );
    }
    render(<Harness />);
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });
});
