// src/modules/schedules/components/BookingSimulator.tsx
import { useState, useMemo } from 'react';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Play, CheckCircle, XCircle, Clock, AlertCircle, AlertTriangle } from 'lucide-react';
import type { Schedule, DayOfWeek } from '../types';
import { getLegTypeLabel, DAYS_OF_WEEK } from '../types';
import { sampleZones, sampleClients } from '../data/sampleData';
import { zipZonesData } from '../../territory/data/sampleData';

interface BookingSimulatorProps {
  schedule: Schedule;
}

interface ZipLookupResult {
  found: boolean;
  zoneName: string | null;
  zoneId: number | null;
  errorMessage?: string;
}

interface DiagnosticCheck {
  label: string;
  passed: boolean;
  detail: string;
}

interface SimulationResult {
  matches: boolean;
  reason: string;
  checks: DiagnosticCheck[];
  legs: {
    legType: string;
    scheduledTime: string;
    description: string;
  }[];
  cutoffExplanation: string;
  lateBookingImpact?: string;
}

// Lookup a zip code in the territory data
function lookupZipCode(zipCode: string): ZipLookupResult {
  if (!zipCode || zipCode.trim().length === 0) {
    return { found: false, zoneName: null, zoneId: null };
  }

  const normalizedZip = zipCode.trim();
  const zipZone = zipZonesData.find(z => z.zip === normalizedZip);

  if (!zipZone) {
    return {
      found: false,
      zoneName: null,
      zoneId: null,
      errorMessage: 'Zip code not assigned to any zone',
    };
  }

  // Try to match to a schedule zone by code or name
  const matchingZone = sampleZones.find(z =>
    z.code === String(zipZone.zoneNumber) ||
    z.name.toLowerCase().includes(zipZone.zoneName.toLowerCase()) ||
    zipZone.zoneName.toLowerCase().includes(z.name.toLowerCase())
  );

  return {
    found: true,
    zoneName: zipZone.zoneName,
    zoneId: matchingZone?.id || null,
  };
}

export function BookingSimulator({ schedule }: BookingSimulatorProps) {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [bookingDate, setBookingDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [bookingTime, setBookingTime] = useState('09:00');
  const [pickupZip, setPickupZip] = useState('');
  const [deliveryZip, setDeliveryZip] = useState('');
  const [result, setResult] = useState<SimulationResult | null>(null);

  // Real-time zip lookups
  const pickupLookup = useMemo(() => lookupZipCode(pickupZip), [pickupZip]);
  const deliveryLookup = useMemo(() => lookupZipCode(deliveryZip), [deliveryZip]);

  const handleRunTest = () => {
    const checks: DiagnosticCheck[] = [];
    let allPassed = true;

    // Parse booking date/time
    const bookingDateTime = new Date(`${bookingDate}T${bookingTime}`);
    const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
      bookingDateTime.getDay()
    ] as DayOfWeek;
    const dayLabel = DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.label || dayOfWeek;

    // Check 1: Operating day
    const daySchedule = schedule.operatingSchedule.days[dayOfWeek];
    if (daySchedule.enabled) {
      checks.push({ label: 'Operating Day', passed: true, detail: `Schedule operates on ${dayLabel}` });
    } else {
      checks.push({ label: 'Operating Day', passed: false, detail: `Schedule does not operate on ${dayLabel}` });
      allPassed = false;
    }

    // Check 2: Pickup zone coverage
    const collectionLeg = schedule.legs.find((leg) => leg.config.type === 'collection');
    if (collectionLeg?.config.type === 'collection' && pickupLookup.zoneId) {
      const covered = collectionLeg.config.pickupZoneIds.includes(pickupLookup.zoneId);
      checks.push({
        label: 'Pickup Zone',
        passed: covered,
        detail: covered
          ? `Zone "${pickupLookup.zoneName}" is in pickup coverage`
          : `Zone "${pickupLookup.zoneName}" not covered by pickup zones`,
      });
      if (!covered) allPassed = false;
    } else if (collectionLeg && pickupZip) {
      checks.push({ label: 'Pickup Zone', passed: false, detail: `Zip "${pickupZip}" not found in zone data` });
      allPassed = false;
    } else if (!collectionLeg) {
      checks.push({ label: 'Pickup Zone', passed: true, detail: 'No collection leg — pickup zone N/A' });
    }

    // Check 3: Delivery zone coverage
    const deliveryLeg = schedule.legs.find((leg) => leg.config.type === 'delivery');
    if (deliveryLeg?.config.type === 'delivery' && deliveryLookup.zoneId) {
      const covered = deliveryLeg.config.deliveryZoneIds.includes(deliveryLookup.zoneId);
      checks.push({
        label: 'Delivery Zone',
        passed: covered,
        detail: covered
          ? `Zone "${deliveryLookup.zoneName}" is in delivery coverage`
          : `Zone "${deliveryLookup.zoneName}" not covered by delivery zones`,
      });
      if (!covered) allPassed = false;
    } else if (deliveryZip) {
      checks.push({ label: 'Delivery Zone', passed: false, detail: `Zip "${deliveryZip}" not found in zone data` });
      allPassed = false;
    }

    // Check 4: Linehaul day check
    const linehaulLegs = schedule.legs.filter(l => l.config.type === 'linehaul');
    for (const lh of linehaulLegs) {
      if (lh.config.type === 'linehaul') {
        const lhDayOk = lh.config.activeDays.includes(dayOfWeek);
        checks.push({
          label: 'Linehaul Active Day',
          passed: lhDayOk,
          detail: lhDayOk
            ? `Linehaul runs on ${dayLabel}`
            : `Linehaul does not run on ${dayLabel} (active: ${lh.config.activeDays.join(', ') || 'none'})`,
        });
        if (!lhDayOk) allPassed = false;
      }
    }

    // Check 5: Cutoff
    const cutoffMinutes = schedule.operatingSchedule.cutoffValue;
    const cutoffUnit = schedule.operatingSchedule.cutoffUnit;

    let cutoffOffset: number;
    if (cutoffUnit === 'minutes') {
      cutoffOffset = cutoffMinutes;
    } else if (cutoffUnit === 'hours') {
      cutoffOffset = cutoffMinutes * 60;
    } else {
      cutoffOffset = cutoffMinutes * 24 * 60;
    }

    const deliveryStartTime = new Date(bookingDateTime);
    if (daySchedule.enabled) {
      const [startHour, startMinute] = daySchedule.startTime.split(':').map(Number);
      deliveryStartTime.setHours(startHour, startMinute, 0, 0);
    }

    const cutoffTime = new Date(deliveryStartTime.getTime() - cutoffOffset * 60 * 1000);
    const isMeetsCutoff = bookingDateTime <= cutoffTime;

    checks.push({
      label: 'Booking Cutoff',
      passed: isMeetsCutoff,
      detail: isMeetsCutoff
        ? `Booking is before cutoff (${cutoffMinutes} ${cutoffUnit} before delivery window)`
        : `Booking is ${Math.round((bookingDateTime.getTime() - cutoffTime.getTime()) / 60000)} min after cutoff`,
    });
    if (!isMeetsCutoff) allPassed = false;

    // Client check
    if (selectedClientId) {
      const clientName = sampleClients.find(c => c.id === selectedClientId)?.name || `#${selectedClientId}`;
      checks.push({ label: 'Client', passed: true, detail: `Testing as client: ${clientName}` });
    }

    // Build leg timeline
    const legs = schedule.legs.map((leg) => {
      let scheduledTime = '';
      let description = '';

      if (leg.config.type === 'collection') {
        const collectionTime = leg.config.pickupTimeMode === 'fixed' && leg.config.lockedCollectionTime
          ? (() => { const [h, m] = leg.config.lockedCollectionTime!.split(':').map(Number); const d = new Date(deliveryStartTime); d.setHours(h, m, 0, 0); return d; })()
          : (() => { const start = leg.config.pickupWindowStart || '14:00'; const [h, m] = start.split(':').map(Number); const d = new Date(deliveryStartTime); d.setHours(h, m, 0, 0); return d; })();
        scheduledTime = collectionTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        description = `Pickup from ${pickupZip} (${pickupLookup.zoneName || 'Unknown zone'})`;
      } else if (leg.config.type === 'depot') {
        scheduledTime = 'Pending';
        description = 'Arrive at depot for processing';
      } else if (leg.config.type === 'linehaul') {
        scheduledTime = 'Pending';
        description = `Transit (${leg.config.transitMinutes} minutes)`;
      } else if (leg.config.type === 'delivery') {
        scheduledTime = daySchedule.enabled ? `${daySchedule.startTime} - ${daySchedule.endTime}` : 'N/A';
        description = `Deliver to ${deliveryZip} (${deliveryLookup.zoneName || 'Unknown zone'})`;
      }

      return { legType: getLegTypeLabel(leg.config.type), scheduledTime, description };
    });

    const cutoffExplanation = `Cutoff: ${cutoffTime.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })}. Booking must be received ${cutoffMinutes} ${cutoffUnit} before delivery window.`;

    const lateBookingImpact = !isMeetsCutoff
      ? `This booking is ${Math.round((bookingDateTime.getTime() - cutoffTime.getTime()) / 60000)} minutes late. It would not appear for this delivery window.`
      : undefined;

    setResult({
      matches: allPassed,
      reason: allPassed ? 'All checks passed' : 'One or more checks failed',
      checks,
      legs,
      cutoffExplanation,
      lateBookingImpact,
    });
  };

  return (
    <div className="space-y-6" data-testid="booking-simulator" aria-label="booking simulator">
      {/* Header */}
      <div className="bg-surface-cream p-4 rounded-lg border border-border">
        <h3 className="text-lg font-semibold text-text-primary mb-2">Booking Simulator</h3>
        <p className="text-sm text-text-secondary">
          Test what happens if a booking is made at a specific date/time for a route.
        </p>
      </div>

      {/* Input Form */}
      <div className="bg-white p-4 rounded-lg border border-border space-y-4">
        <h4 className="text-sm font-semibold text-text-primary">Test Inputs</h4>

        <Select
          label="Client (optional)"
          value={selectedClientId || ''}
          onChange={(e) => setSelectedClientId(e.target.value ? Number(e.target.value) : null)}
          options={[
            { value: '', label: 'No client (base schedule)' },
            ...sampleClients.map(c => ({ value: c.id, label: c.name })),
          ]}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            type="date"
            label="Booking Date"
            value={bookingDate}
            onChange={(e) => setBookingDate(e.target.value)}
          />
          <Input
            type="time"
            label="Booking Time"
            value={bookingTime}
            onChange={(e) => setBookingTime(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pickup Zip Code */}
          <div className="space-y-2">
            <Input
              type="text"
              label="Pickup Zip Code"
              placeholder="Enter zip code..."
              value={pickupZip}
              onChange={(e) => setPickupZip(e.target.value)}
            />
            {pickupZip && pickupLookup.found && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-green-700">Zone: {pickupLookup.zoneName}</span>
              </div>
            )}
            {pickupZip && !pickupLookup.found && pickupLookup.errorMessage && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-orange-600">{pickupLookup.errorMessage}</span>
              </div>
            )}
          </div>

          {/* Delivery Zip Code */}
          <div className="space-y-2">
            <Input
              type="text"
              label="Delivery Zip Code"
              placeholder="Enter zip code..."
              value={deliveryZip}
              onChange={(e) => setDeliveryZip(e.target.value)}
            />
            {deliveryZip && deliveryLookup.found && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-green-700">Zone: {deliveryLookup.zoneName}</span>
              </div>
            )}
            {deliveryZip && !deliveryLookup.found && deliveryLookup.errorMessage && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-orange-600">{deliveryLookup.errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        <Button variant="primary" onClick={handleRunTest} className="w-full">
          <Play className="w-4 h-4 mr-2" />
          Run Test
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Match Result */}
          <div
            className={`p-4 rounded-lg border ${
              result.matches
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <div className="flex items-center gap-3">
              {result.matches ? (
                <CheckCircle className="w-6 h-6 text-green-600" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600" />
              )}
              <div>
                <h4 className="text-sm font-semibold text-text-primary">
                  {result.matches ? 'Schedule Matches' : 'Schedule Does Not Match'}
                </h4>
                <p className="text-sm text-text-secondary">{result.reason}</p>
              </div>
            </div>
          </div>

          {/* Per-check Diagnostics */}
          {result.checks.length > 0 && (
            <div className="bg-white p-4 rounded-lg border border-border">
              <h4 className="text-sm font-semibold text-text-primary mb-3">Diagnostic Checks</h4>
              <div className="space-y-1">
                {result.checks.map((check, i) => (
                  <div key={i} className="flex items-start gap-2 py-1">
                    {check.passed ? (
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div>
                      <span className="text-sm font-medium">{check.label}</span>
                      <p className="text-xs text-text-muted">{check.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cutoff Explanation */}
          <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-text-primary mb-1">Cutoff Time</h4>
                <p className="text-sm text-text-secondary">{result.cutoffExplanation}</p>
              </div>
            </div>
          </div>

          {/* Late Booking Impact */}
          {result.lateBookingImpact && (
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-text-primary mb-1">
                    Late Booking Impact
                  </h4>
                  <p className="text-sm text-text-secondary">{result.lateBookingImpact}</p>
                </div>
              </div>
            </div>
          )}

          {/* Leg Breakdown */}
          {result.legs.length > 0 && (
            <div className="bg-white p-4 rounded-lg border border-border">
              <h4 className="text-sm font-semibold text-text-primary mb-3">Leg Breakdown</h4>
              <div className="space-y-2">
                {result.legs.map((leg, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-surface-cream rounded-lg"
                  >
                    <div>
                      <Badge variant="blue" size="sm" className="mb-1">
                        {leg.legType}
                      </Badge>
                      <p className="text-sm text-text-secondary">{leg.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-text-primary">
                        {leg.scheduledTime}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pricing Placeholder */}
          <div className="bg-gray-50 p-4 rounded-lg border border-border">
            <h4 className="text-sm font-semibold text-text-muted mb-2">💰 Pricing</h4>
            <p className="text-sm text-text-muted italic">Pricing will be available when the rates module is connected.</p>
          </div>
        </div>
      )}
    </div>
  );
}
