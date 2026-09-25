import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, exportJobsToCsv } from './csvExport';
import type { BulkJob } from '../types';

function makeJob(overrides: Partial<BulkJob>): BulkJob {
  return {
    bulkJobId: 0,
    jobNumber: null,
    bookDate: '',
    bookTime: '',
    jobStatus: 0,
    clientId: 0,
    clientCode: null,
    amount: null,
    speed: 0,
    speedName: null,
    fromCompany: null,
    fromAddress: null,
    fromSuburb: null,
    fromPostCode: null,
    toCompany: null,
    toAddress: null,
    toSuburb: null,
    toPostCode: null,
    size: null,
    qty: null,
    weight: null,
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
    prebookJob: null,
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
    ...overrides,
  };
}

const capturedBlobs: Blob[] = [];
let capturedFilename: string | null = null;
let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  capturedBlobs.length = 0;
  capturedFilename = null;
  (URL as any).createObjectURL = vi.fn((blob: Blob) => {
    capturedBlobs.push(blob);
    return 'blob:mock';
  });
  (URL as any).revokeObjectURL = vi.fn();
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    capturedFilename = this.download;
  });
});

afterEach(() => {
  clickSpy.mockRestore();
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('exportJobsToCsv', () => {
  it('produces a header row plus one row per job', async () => {
    const jobs = [
      makeJob({ bulkJobId: 1, clientCode: 'ABC', jobNumber: 'J-1', toPostCode: 1010 }),
    ];
    exportJobsToCsv(jobs, false);
    const csv = await readBlob(capturedBlobs[0]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Client');
    expect(lines[0]).toContain('To Postcode');
    expect(lines[1]).toContain('ABC');
    expect(lines[1]).toContain('J-1');
  });

  it('uses To Zip header for US tenants', async () => {
    exportJobsToCsv([makeJob({ bulkJobId: 1 })], true);
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('To Zip');
    expect(csv).not.toContain('To Postcode');
  });

  it('quotes values that contain commas', async () => {
    const jobs = [makeJob({ bulkJobId: 1, toAddress: '10 High St, Apt 3' })];
    exportJobsToCsv(jobs, false);
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('"10 High St, Apt 3"');
  });

  it('escapes embedded quotes by doubling them', async () => {
    const jobs = [makeJob({ bulkJobId: 1, toAddress: 'Bob "Big" Store' })];
    exportJobsToCsv(jobs, false);
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('"Bob ""Big"" Store"');
  });

  it('starts the file with a UTF-8 BOM', async () => {
    exportJobsToCsv([makeJob({ bulkJobId: 1 })], false);
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('formats the schedule window as HH:mm-HH:mm', async () => {
    const jobs = [
      makeJob({
        bulkJobId: 1,
        scheduleWindowStart: '2026-08-13T09:15:00Z',
        scheduleWindowEnd: '2026-08-13T11:45:00Z',
      }),
    ];
    exportJobsToCsv(jobs, false);
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('09:15-11:45');
  });

  it('leaves window blank when either start or end is missing', async () => {
    const jobs = [makeJob({ bulkJobId: 1, scheduleWindowStart: null, scheduleWindowEnd: null })];
    exportJobsToCsv(jobs, false);
    const csv = await readBlob(capturedBlobs[0]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain(',,');
  });

  it('uses supplied filename', async () => {
    exportJobsToCsv([makeJob({ bulkJobId: 1 })], false, 'my-file.csv');
    expect(capturedFilename).toBe('my-file.csv');
  });

  it('defaults filename to jobs-yyyy-MM-dd.csv when none supplied', async () => {
    exportJobsToCsv([makeJob({ bulkJobId: 1 })], false);
    expect(capturedFilename).toMatch(/^jobs-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('falls back to numeric speed when speedName is null', async () => {
    const jobs = [makeJob({ bulkJobId: 1, speedName: null, speed: 7 })];
    exportJobsToCsv(jobs, false);
    const csv = await readBlob(capturedBlobs[0]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain(',7,');
  });
});

describe('downloadCsv', () => {
  it('joins rows with CRLF', async () => {
    downloadCsv([['a', 'b'], ['1', '2']], 'out.csv');
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('a,b\r\n1,2');
  });

  it('quotes cells containing commas', async () => {
    downloadCsv([['h1'], ['x,y']], 'out.csv');
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('"x,y"');
  });

  it('quotes cells with newlines', async () => {
    downloadCsv([['h1'], ['line1\nline2']], 'out.csv');
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('renders null and undefined as empty string', async () => {
    downloadCsv([['h1', 'h2'], [null, undefined]], 'out.csv');
    const csv = await readBlob(capturedBlobs[0]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toBe(',');
  });

  it('stringifies numbers', async () => {
    downloadCsv([['n'], [123]], 'out.csv');
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv).toContain('123');
  });

  it('starts the file with a UTF-8 BOM', async () => {
    downloadCsv([['a']], 'out.csv');
    const csv = await readBlob(capturedBlobs[0]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('uses the supplied filename', async () => {
    downloadCsv([['x']], 'named.csv');
    expect(capturedFilename).toBe('named.csv');
  });
});
