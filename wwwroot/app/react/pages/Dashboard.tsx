import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useVisibleFeatures } from '../hooks/queries/useVisibleFeatures';
import { useTodaySummary } from '../hooks/queries/useTodaySummary';
import type { TodaySummary } from '../lib/todaySummary';
import { makeFeatureAllowed, type RoFeatureKey } from '../lib/accessSwitches';
import { isPartnerDeniedPath } from '../lib/partnerAccess';
import { postcodePluralLabel } from '../lib/tenantLabels';
import { RoIcon, type RoIconName } from '../components/common/RoIcon';

// The Routed Operations home page: one card per page, grouped by what the
// person is there to do, each with an icon and one plain line saying what
// the page is for. Above the cards, today's counts, read from the same data
// Route Viewer loads (see lib/todaySummary), for a person who can open it.
//
// A card shows only when the person can open its page. That is the same rule
// the Sidebar and the route guard use (Access Control switches, the network
// partner list, DFRNT-staff-only pages), so the home page never offers a link
// that lands on "This page isn't available".

interface HomeCard {
  to: string;
  title: string;
  blurb: string;
  icon: RoIconName;
  /** Every switch the page sits behind. A Route Viewer child needs the
   *  group's switch and its own, as in navItems. */
  keys: readonly RoFeatureKey[];
  /** Small pill after the title. */
  tag?: { text: string; tone: 'new' | 'internal' };
  /** DFRNT staff only (mirrors the Sidebar's internalOnly gate). */
  internalOnly?: boolean;
  /** Wide card with a button, for the page most people open first. */
  lead?: { cta: string };
}

interface HomeGroup {
  title: string;
  hint: string;
  cards: HomeCard[];
}

function buildGroups(isUs: boolean): HomeGroup[] {
  // "postcodes" for NZ and AU, "ZIPs" for the US.
  const codes = isUs ? postcodePluralLabel(true).replace('Zips', 'ZIPs') : postcodePluralLabel(false).toLowerCase();
  return [
    {
      title: 'Run the day',
      hint: 'What is happening right now',
      cards: [
        {
          to: '/route-viewer',
          title: 'Route Viewer',
          blurb: 'Every run for the day on one screen. Assign a driver or partner, follow progress on the map, and deal with exceptions.',
          icon: 'route',
          keys: ['ro-route-viewer', 'ro-route-viewer-runs'],
          lead: { cta: "Open today's runs" },
        },
        { to: '/route-viewer/linehaul', title: 'Linehaul', blurb: 'Follow freight between depots and airports, leg by leg.', icon: 'plane', keys: ['ro-route-viewer', 'ro-linehaul'] },
        { to: '/route-viewer/scans', title: 'Scan Manager', blurb: 'See every scan, and what has not been scanned yet.', icon: 'scan', keys: ['ro-route-viewer', 'ro-scan-manager'] },
        { to: '/route-viewer/print', title: 'Print Manager', blurb: 'Print run sheets and labels for a run.', icon: 'print', keys: ['ro-route-viewer', 'ro-print-manager'] },
        { to: '/route-viewer/cs', title: 'Customer Services', blurb: 'Find a job fast when a customer calls.', icon: 'headset', keys: ['ro-route-viewer', 'ro-customer-services'] },
      ],
    },
    {
      title: 'Plan',
      hint: 'Set up the work before it happens',
      cards: [
        { to: '/recurring-routes', title: 'Recurring Routes', blurb: `Your regular routes: the ${codes} they cover and who runs them.`, icon: 'repeat', keys: ['ro-recurring-routes'] },
        { to: '/schedules-new', title: 'Schedules', blurb: 'Which days and times each service runs, and for which customers.', icon: 'calendar', keys: ['ro-schedules-new'], tag: { text: 'New', tone: 'new' } },
        { to: '/client-overrides', title: 'Client Overrides', blurb: 'Exceptions to the schedule for one customer.', icon: 'sliders', keys: ['ro-client-overrides'] },
        { to: '/driver-scheduling', title: 'Driver Rostering', blurb: 'Who is available, when, and on which route.', icon: 'users', keys: ['ro-driver-rostering'] },
        { to: '/polygon-builder', title: 'Polygon Builder', blurb: `Pick the ${codes} a route or zone covers on the map.`, icon: 'polygon', keys: ['ro-polygon-builder'] },
      ],
    },
    {
      title: 'Tools',
      hint: 'Used now and then',
      cards: [
        { to: '/bulk-import', title: 'Bulk Import', blurb: 'Load many jobs at once from a spreadsheet.', icon: 'upload', keys: ['ro-bulk-import'] },
        { to: '/routes', title: 'Route Builder', blurb: 'Build and edit one-off runs by hand on the map.', icon: 'map', keys: ['ro-route-builder'] },
        { to: '/quoting', title: 'Quoting', blurb: 'Work out drivers needed and cost for a new piece of work.', icon: 'calculator', keys: ['ro-quoting'] },
        { to: '/auto-assign-log', title: 'Auto-Assign Log', blurb: 'See which jobs were put on a run automatically, and why.', icon: 'checklist', keys: ['ro-auto-assign-log'] },
        {
          to: '/historic-archive',
          title: 'Historic Archive Upload',
          blurb: "Load a tenant's old job history.",
          icon: 'archive',
          keys: ['ro-historic-archive'],
          tag: { text: 'DFRNT only', tone: 'internal' },
          internalOnly: true,
        },
      ],
    },
  ];
}

/** "morning" before noon, "afternoon" until 5pm, then "evening", by the tenant's clock. */
function partOfDay(now: Date, timeZone: string | null): 'morning' | 'afternoon' | 'evening' {
  let hour = now.getHours();
  if (timeZone) {
    try {
      const text = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now);
      const parsed = Number.parseInt(text, 10);
      if (!Number.isNaN(parsed)) hour = parsed;
    } catch {
      // Unknown zone name: keep the browser's hour.
    }
  }
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function todayLabel(now: Date, timeZone: string | null): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  try {
    return new Intl.DateTimeFormat('en-GB', timeZone ? { ...options, timeZone } : options).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-GB', options).format(now);
  }
}

const TAG_TONE: Record<'new' | 'internal', string> = {
  new: 'bg-brand-cyan/20 text-brand-dark',
  internal: 'bg-brand-orange/20 text-brand-dark',
};

function Tag({ tag }: { tag: NonNullable<HomeCard['tag']> }) {
  return (
    <span className={`ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold leading-none ${TAG_TONE[tag.tone]}`}>
      {tag.text}
    </span>
  );
}

function LeadCard({ card }: { card: HomeCard }) {
  return (
    <Link
      to={card.to}
      className="flex items-start gap-4 rounded-2xl bg-brand-dark p-5 text-white transition hover:-translate-y-0.5 hover:shadow-lg sm:col-span-2"
    >
      <span className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-brand-cyan text-brand-dark">
        <RoIcon name={card.icon} />
      </span>
      <span className="block">
        <span className="block text-xl font-semibold">{card.title}</span>
        <span className="mt-1 block text-sm font-light">{card.blurb}</span>
        <span className="mt-3 inline-block rounded bg-brand-cyan px-3 py-1.5 text-sm font-semibold text-brand-dark">
          {card.lead?.cta}
        </span>
      </span>
    </Link>
  );
}

function PageCard({ card }: { card: HomeCard }) {
  return (
    <Link
      to={card.to}
      className="flex items-start gap-4 rounded-2xl bg-surface-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <span className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-brand-cyan/20 text-brand-dark">
        <RoIcon name={card.icon} />
      </span>
      <span className="block">
        <span className="block text-base font-semibold text-text-primary">
          {card.title}
          {card.tag && <Tag tag={card.tag} />}
        </span>
        <span className="mt-0.5 block text-sm font-light text-text-primary">{card.blurb}</span>
      </span>
    </Link>
  );
}

const ROUTE_VIEWER_KEYS: readonly RoFeatureKey[] = ['ro-route-viewer', 'ro-route-viewer-runs'];

type Tone = 'plain' | 'good' | 'warn' | 'bad';
const TONE: Record<Tone, string> = {
  plain: 'text-text-primary',
  good: 'text-emerald-600',
  warn: 'text-brand-orange',
  bad: 'text-red-600',
};

interface Count {
  label: string;
  icon: RoIconName;
  pick: (summary: TodaySummary) => number;
  /** Colour when the count is above zero. Zero is always plain. */
  tone: Tone;
}

const COUNTS: readonly Count[] = [
  { label: 'Runs today', icon: 'route', pick: (s) => s.runs, tone: 'plain' },
  { label: 'Jobs today', icon: 'box', pick: (s) => s.jobs, tone: 'plain' },
  { label: 'Picked up', icon: 'scan', pick: (s) => s.pickedUp, tone: 'good' },
  { label: 'Runs with no driver or partner', icon: 'truck', pick: (s) => s.unassignedRuns, tone: 'warn' },
  { label: 'On the exceptions list', icon: 'alert', pick: (s) => s.exceptions, tone: 'bad' },
];

/** One panel with keyline dividers. Every count opens Route Viewer. A count
 *  that is still loading or could not be loaded shows a dash, never a zero. */
function TodayStrip({ summary }: { summary: TodaySummary | null }) {
  return (
    <section aria-label="Today" className="mb-7 grid grid-cols-2 overflow-hidden rounded-2xl bg-surface-white sm:grid-cols-3 xl:grid-cols-5">
      {COUNTS.map((count) => {
        const value = summary ? count.pick(summary) : null;
        const tone = value ? TONE[count.tone] : TONE.plain;
        return (
          <Link
            key={count.label}
            to="/route-viewer"
            className="flex items-center gap-3 border-b border-l border-border-light px-5 py-4 transition hover:bg-surface-light"
          >
            <span className="flex-none text-brand-dark/70"><RoIcon name={count.icon} /></span>
            <span className="block">
              <span className={`block text-2xl font-bold leading-tight ${tone}`}>{value ?? '-'}</span>
              <span className="block text-sm font-light text-text-primary">{count.label}</span>
            </span>
          </Link>
        );
      })}
    </section>
  );
}

export default function Dashboard() {
  const user = useAuth();
  const { visibleFeatures, status } = useVisibleFeatures();

  const allowed = user.bypassesFeatureSwitches ? () => true : makeFeatureAllowed(status, visibleFeatures);
  const canOpen = (card: HomeCard) =>
    (!card.internalOnly || user.isInternal)
    && !(user.isNetworkPartner && isPartnerDeniedPath(card.to))
    && card.keys.every((key) => allowed(key));

  // Today's counts only for a person who can open Route Viewer, and only once
  // the switches have answered, so nothing is requested for anyone else.
  const canSeeToday = !(user.isNetworkPartner && isPartnerDeniedPath('/route-viewer'))
    && (user.bypassesFeatureSwitches || (status === 'ready' && ROUTE_VIEWER_KEYS.every((key) => allowed(key))));
  const today = useTodaySummary(canSeeToday);

  const groups = buildGroups(user.isUsTenant)
    .map((group) => ({ ...group, cards: group.cards.filter(canOpen) }))
    .filter((group) => group.cards.length > 0);

  const now = new Date();
  const firstName = (user.fullName ?? '').trim().split(/\s+/)[0];
  const greeting = `Good ${partOfDay(now, user.timeZone)}${firstName ? `, ${firstName}` : ''}`;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold text-text-primary">{greeting}</h1>
        <p className="mb-6 mt-1 text-base font-light text-text-primary">{todayLabel(now, user.timeZone)}</p>

        {today.status !== 'off' && <TodayStrip summary={today.summary} />}

        {groups.length === 0 && (
          <p className="rounded-2xl bg-surface-white p-5 text-sm text-text-primary">
            None of the Routed Operations pages are switched on for you yet.
            Ask your administrator to switch on the pages you need in Access Control.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.title} className="mb-7">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-primary">
              {group.title}
              <span className="ml-3 text-sm font-light normal-case tracking-normal">{group.hint}</span>
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {group.cards.map((card) =>
                card.lead ? <LeadCard key={card.to} card={card} /> : <PageCard key={card.to} card={card} />,
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
