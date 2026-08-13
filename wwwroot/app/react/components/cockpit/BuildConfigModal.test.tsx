import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { BuildConfigModal } from './BuildConfigModal';
import type { BuildConfig, BulkJob, VehicleSize } from '@/types';

const defaultConfig: BuildConfig = {
  buildParameter: 'maxBoxes',
  minutesPerStop: 5,
  vehicleCapacityEnabled: false,
  vehicleSizeId: 1,
  vehicleCubicCap: 12,
  routingMode: 'aToB',
  finishAtBulkJobId: null,
  noReroute: false,
  respectPickupCutoff: false,
};

const vehicleSizes: VehicleSize[] = [
  { vehicleSizeId: 1, vehicleName: 'Van', cubicCapacity: 12 },
  { vehicleSizeId: 2, vehicleName: 'Truck', cubicCapacity: 24 },
];

function makeJob(id: number, over: Partial<BulkJob> = {}): BulkJob {
  return {
    bulkJobId: id,
    jobNumber: `J-${id}`,
    bookDate: '2026-08-13',
    bookTime: '09:30:00',
    jobStatus: 0,
    clientId: 1,
    clientCode: 'ACME',
    amount: 0,
    speed: 10,
    speedName: null,
    fromCompany: null,
    fromAddress: null,
    fromSuburb: null,
    fromPostCode: null,
    toCompany: null,
    toAddress: null,
    toSuburb: 'Suburb-' + id,
    toPostCode: 1000 + id,
    size: 0,
    qty: 0,
    weight: 0,
    courierId: null,
    courierName: null,
    clientRefa: null,
    clientRefb: null,
    ourRef: null,
    notes: null,
    pickUpLatitude: null,
    pickUpLongitude: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    prebookJob: false,
    onHold: false,
    void: false,
    done: false,
    bulkRunId: null,
    runName: null,
    runOrder: null,
    multiboxParentId: null,
    parentId: null,
    regionId: null,
    barcode: null,
    okToLeave: null,
    contact: null,
    deliverToContact: null,
    deliverToPhone: null,
    trackingEmail: null,
    trackingMobile: null,
    proofOfDeliveryEmail: null,
    proofOfDeliveryMobile: null,
    scheduleId: null,
    scheduleName: null,
    scheduleWindowStart: null,
    scheduleWindowEnd: null,
    jobCubicM3: null,
    maxJobsPerRun: null,
    applyPickupCutoff: null,
    pickupCutoffHours: null,
    prefixRunName: null,
    postCodeMergeTo: null,
    runSequence: 0,
    bulkJobRunId: 0,
    ...over,
  };
}

type Props = Parameters<typeof BuildConfigModal>[0];
function props(over: Partial<Props> = {}): Props {
  return {
    open: true,
    config: defaultConfig,
    vehicleSizes,
    selectedJobCount: 3,
    selectedJobs: [],
    onClose: vi.fn(),
    onSave: vi.fn(),
    ...over,
  };
}

describe('BuildConfigModal', () => {
  it('renders open state with default fields', () => {
    renderWithProviders(<BuildConfigModal {...props()} />);
    expect(screen.getByRole('heading', { name: 'Build Runs Configuration' })).toBeInTheDocument();
    expect(screen.getByText('Build Parameter')).toBeInTheDocument();
    expect(screen.getByText('Minutes per stop / drop')).toBeInTheDocument();
    expect(screen.getByText('Routing mode')).toBeInTheDocument();
  });

  it('does not render the modal content when closed', () => {
    renderWithProviders(<BuildConfigModal {...props({ open: false })} />);
    expect(screen.queryByRole('heading', { name: 'Build Runs Configuration' })).not.toBeInTheDocument();
  });

  it('changes minutes per stop and saves via commit', () => {
    const onSave = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave })} />);
    const input = screen.getByDisplayValue('5') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ minutesPerStop: 9 }));
  });

  it('save is called with the routing mode change', () => {
    const onSave = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave })} />);
    // Radios use sr-only class; select via label text "A-A circuit" click on the label.
    fireEvent.click(screen.getByText('A-A circuit'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ routingMode: 'aToA' }));
  });

  it('shows the Finish at picker when routingMode = finishAtStop', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <BuildConfigModal
        {...props({
          onSave,
          selectedJobs: [makeJob(11), makeJob(12)],
        })}
      />
    );
    fireEvent.click(screen.getByText('Finish at stop'));
    expect(screen.getByText('Finish at:')).toBeInTheDocument();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ finishAtBulkJobId: 12 }));
  });

  it('warns Select jobs first inside the finish-at picker when selectedJobs is empty', () => {
    renderWithProviders(<BuildConfigModal {...props({ selectedJobs: [] })} />);
    fireEvent.click(screen.getByText('Finish at stop'));
    expect(screen.getByText('Select jobs first')).toBeInTheDocument();
  });

  it('toggles Fix route and Respect pickup cutoff checkboxes', () => {
    const onSave = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave })} />);
    const [fixRoute, respectCutoff] = screen.getAllByRole('checkbox');
    fireEvent.click(fixRoute);
    fireEvent.click(respectCutoff);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ noReroute: true, respectPickupCutoff: true }));
  });

  it('enables vehicle capacity + swaps to custom cubic input', () => {
    const onSave = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave })} />);
    fireEvent.click(screen.getByLabelText('Vehicle Capacity'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'custom' } });
    const cubic = screen.getByDisplayValue('12') as HTMLInputElement;
    fireEvent.change(cubic, { target: { value: '18.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleCapacityEnabled: true,
        vehicleSizeId: 'custom',
        vehicleCubicCap: 18.5,
      })
    );
  });

  it('swapping vehicle size copies its cubic capacity into vehicleCubicCap', () => {
    const onSave = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave })} />);
    fireEvent.click(screen.getByLabelText('Vehicle Capacity'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleSizeId: 2, vehicleCubicCap: 24 })
    );
  });

  it('blocks Save when minutesPerStop is negative and fires the confirm alert', () => {
    const onSave = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave })} />);
    const input = screen.getByDisplayValue('5') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows Build button when onConfirm is wired, disabled at selectedJobCount=0', () => {
    renderWithProviders(<BuildConfigModal {...props({ selectedJobCount: 0, onConfirm: vi.fn() })} />);
    expect(screen.getByRole('button', { name: 'Build' })).toBeDisabled();
    expect(screen.getByText(/Select at least one job/)).toBeInTheDocument();
  });

  it('Build path fires both onSave and onConfirm', () => {
    const onSave = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave, onConfirm, selectedJobCount: 2 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    expect(onSave).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });

  it('emits onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onClose })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('changes build parameter to Delivery Window', () => {
    const onSave = vi.fn();
    renderWithProviders(<BuildConfigModal {...props({ onSave })} />);
    fireEvent.click(screen.getByText('Delivery Window'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ buildParameter: 'deliveryWindow' }));
  });
});
