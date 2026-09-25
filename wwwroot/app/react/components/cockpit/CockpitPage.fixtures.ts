import type { BulkJob, Courier, Run, RunJob, VehicleSize } from '@/types';

/**
 * Shared fixtures for the CockpitPage per-action test files. Each test file
 * builds its own MSW handlers on top; the shape helpers here just cut the
 * boilerplate of writing a full BulkJob / Run / RunJob for every scenario.
 * Not exported through any index - test files import via the relative path.
 */

export function makeJob(id: number, over: Partial<BulkJob> = {}): BulkJob {
  return {
    bulkJobId: id,
    jobNumber: `J-${id}`,
    bookDate: '2026-08-13',
    bookTime: '2026-08-13T09:30:00',
    jobStatus: 0,
    clientId: 100,
    clientCode: 'ACME',
    amount: 0,
    speed: 10,
    speedName: 'Std',
    fromCompany: null,
    fromAddress: null,
    fromSuburb: null,
    fromPostCode: null,
    toCompany: null,
    toAddress: `${id} Test St`,
    toSuburb: 'Suburbia',
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
    pickUpLatitude: '-36.85',
    pickUpLongitude: '174.76',
    deliveryLatitude: '-36.86',
    deliveryLongitude: '174.76',
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

export function makeRunJob(id: number, over: Partial<RunJob> = {}): RunJob {
  return {
    bulkJobId: id,
    builderIndex: 1,
    jobNumber: `J-${id}`,
    isStart: false,
    isEnd: false,
    clientCode: 'ACME',
    deliveryDate: '2026-08-13',
    bookTime: '2026-08-13T09:30:00',
    toAddress: `${id} Test St`,
    toSuburb: 'Suburbia',
    toPostCode: 1000 + id,
    courierName: null,
    speedName: 'Std',
    deliveryLatitude: '-36.86',
    amount: 0,
    ...over,
  };
}

export function makeRun(id: number, over: Partial<Run> = {}): Run {
  return {
    id,
    name: `RUN-${id}`,
    mins: 20,
    kms: 5,
    courierId: null,
    courierName: null,
    status: 0,
    revenue: null,
    payout: null,
    courierPercentage: null,
    googleRouteResponse: null,
    despatchDateTime: '2026-08-13',
    noReroute: false,
    routingMode: 0,
    finishAtBulkJobId: null,
    isVoidRun: false,
    fleet: null,
    jobs: [],
    ...over,
  };
}

export function makeCourier(id: number, over: Partial<Courier> = {}): Courier {
  return {
    courierId: id,
    code: `C${id}`,
    firstName: `Cour-${id}`,
    displayName: `Courier ${id}`,
    fleet: null,
    ...over,
  };
}

export const defaultVehicleSizes: VehicleSize[] = [
  { vehicleSizeId: 1, vehicleName: 'Van', cubicCapacity: 12 },
];
