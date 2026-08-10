import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { routeViewerService } from '../../services/routeViewerService';
import { AssignRouteDialog } from './AssignRouteDialog';
import { TransferRouteDialog } from './TransferRouteDialog';

// Route Viewer run-list right-click menu (master Section 7.10 runListMenu).
// P4 core - Assign Route (NP shows "Assign Courier"), UnAssign submenu,
// Send SMS (stub), Pre-assign gated to run.id >= 0 (synthetic Route Runs
// carry negative ids), Validate Route stub, Create Courier Event stub.
// The bulk-action items (Missing / Complete / Cancel) live on the
// jobListMenu in P4b - this menu is run-scoped only.

interface Props {
  x: number;
  y: number;
  runId: number;
  runDate: string;
  onClose: () => void;
  onDone: () => void;
}

export function RvRunContextMenu({ x, y, runId, runDate: _runDate, onClose, onDone }: Props) {
  const user = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Esc. Skip while a child dialog is open so
  // the operator does not lose the whole flow on the first backdrop
  // click of the dialog itself.
  useEffect(() => {
    if (assignOpen || transferOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, assignOpen, transferOpen]);

  const preAssignable = runId >= 0;

  const doPreAssign = async () => {
    onClose();
    if (!(await confirm({
      title: 'Pre-assign run',
      message: 'Lock this run to its currently allocated courier?',
    }))) return;
    // Endpoint not wired in P1 - stub with a toast so the wire-up is
    // obvious when the endpoint lands.
    toast.show('Pre-assign endpoint pending (P4b).');
  };

  const doUnassign = async (kind: 'courier' | 'agent' | 'np') => {
    onClose();
    const label = kind === 'courier' ? 'courier' : kind === 'agent' ? 'agent' : 'network partner';
    if (!(await confirm({
      title: `Unassign ${label}`,
      message: `Remove the current ${label} from run #${runId}?`,
      danger: true,
    }))) return;
    toast.show(`Unassign ${label} endpoint pending (P4b).`);
  };

  return (
    <>
      <div
        ref={menuRef}
        className="fixed z-50 bg-surface-white border border-border rounded-md shadow-lg py-1 text-sm min-w-[14rem]"
        style={{ left: x, top: y }}
      >
        <MenuItem onClick={() => { setAssignOpen(true); }}>
          {user.isNetworkPartner ? 'Assign Courier' : 'Assign Route'}
        </MenuItem>
        {!user.isNetworkPartner && (
          <MenuItem onClick={() => setTransferOpen(true)}>Transfer Route</MenuItem>
        )}
        <MenuItem onClick={() => { onClose(); toast.show('Send SMS pending (P4b).'); }}>
          Send SMS to run's customers
        </MenuItem>
        <MenuItem onClick={doPreAssign} disabled={!preAssignable}>
          Pre-assign Run
        </MenuItem>
        <MenuItem onClick={() => { onClose(); toast.show('Validate Route pending (P4b).'); }}>
          Validate Route
        </MenuItem>

        <div className="border-t border-border my-1" />
        <div className="px-3 py-1 text-[10px] uppercase text-text-muted">Unassign</div>
        <MenuItem onClick={() => doUnassign('courier')}>Courier</MenuItem>
        {!user.isNetworkPartner && <MenuItem onClick={() => doUnassign('agent')}>Agent</MenuItem>}
        {!user.isNetworkPartner && <MenuItem onClick={() => doUnassign('np')}>Network Partner</MenuItem>}

        <div className="border-t border-border my-1" />
        <MenuItem onClick={() => { onClose(); toast.show('Create Courier Event pending (P4b).'); }}>
          Create Courier Event
        </MenuItem>
      </div>

      {assignOpen && (
        <AssignRouteDialog
          runId={runId}
          onClose={() => { setAssignOpen(false); onClose(); }}
          onSuccess={(summary) => {
            setAssignOpen(false);
            onClose();
            toast.show(summary);
            onDone();
          }}
        />
      )}

      {transferOpen && (
        <TransferRouteDialog
          runId={runId}
          onClose={() => { setTransferOpen(false); onClose(); }}
          onSuccess={(summary) => {
            setTransferOpen(false);
            onClose();
            toast.show(summary);
            onDone();
          }}
        />
      )}
    </>
  );
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 ${
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : 'text-text-primary hover:bg-brand-cyan/10 cursor-pointer'
      }`}
    >
      {children}
    </button>
  );
}
