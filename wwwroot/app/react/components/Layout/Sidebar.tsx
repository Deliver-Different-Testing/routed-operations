import { useEffect, useId, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isPartnerDeniedPath } from '../../lib/partnerAccess';
import { makeFeatureAllowed } from '../../lib/accessSwitches';
import { useVisibleFeatures } from '../../hooks/queries/useVisibleFeatures';
import { RoIcon, type RoIconName } from '../common/RoIcon';
import { navItems, type NavItem } from './navItems';

// The side menu, laid out the way the Settings app lays out its own: a header
// naming the app, then icon sections that open to show their pages, with the
// current page marked by an accent bar instead of a filled block.
//
// The sections are presentation only. WHICH pages a person may see still comes
// from navItems and its Access Control switches, exactly as before; this file
// only decides where each visible page sits. A page that is in navItems but in
// no section below lands in Tools, so adding a page can never drop it from the
// menu (Sidebar.test.tsx pins that).

interface MenuSection {
  id: string;
  label: string;
  icon: RoIconName;
  /** Page paths in display order. '/route-viewer' stands for the whole
   *  Route Viewer group, whose pages keep the order navItems gives them. */
  paths: readonly string[];
}

const HOME_PATH = '/dashboard';

const SECTIONS: readonly MenuSection[] = [
  { id: 'run', label: 'Run the day', icon: 'route', paths: ['/route-viewer'] },
  {
    id: 'plan',
    label: 'Plan',
    icon: 'calendar',
    paths: ['/recurring-routes', '/schedules-new', '/client-overrides', '/driver-scheduling', '/polygon-builder'],
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: 'tools',
    paths: ['/bulk-import', '/routes', '/quoting', '/auto-assign-log'],
  },
];
const CATCH_ALL_SECTION = 'tools';

interface MenuLeaf {
  item: NavItem;
  /** True when a sibling page lives under this page's path, so it must only
   *  light up on an exact match (Route Viewer at /route-viewer). */
  exact: boolean;
}

interface VisibleSection extends MenuSection {
  leaves: MenuLeaf[];
}

function isOnPage(pathname: string, leaf: MenuLeaf): boolean {
  return pathname === leaf.item.to || (!leaf.exact && pathname.startsWith(leaf.item.to + '/'));
}

const ROW = 'flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm transition-colors hover:bg-white/10';
const ROW_ACTIVE = 'bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_theme(colors.brand.cyan)]';
const ROW_IDLE = 'text-white/80';

function Badge({ text }: { text: string }) {
  return (
    <span className="rounded border border-brand-cyan/40 bg-brand-cyan/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide text-brand-cyan">
      {text}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 flex-none text-white/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SectionBlock({
  section, open, onToggle, holdsCurrentPage,
}: { section: VisibleSection; open: boolean; onToggle: () => void; holdsCurrentPage: boolean }) {
  const panelId = useId();
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        // A closed section that holds the current page carries the accent, so
        // the person can still see where they are.
        className={`${ROW} justify-between ${holdsCurrentPage && !open ? ROW_ACTIVE : holdsCurrentPage ? 'font-semibold text-white' : ROW_IDLE}`}
      >
        <span className="flex items-center gap-3">
          <RoIcon name={section.icon} className="h-5 w-5 flex-none" />
          <span>{section.label}</span>
        </span>
        <Chevron open={open} />
      </button>
      {/* grid-rows 0fr <-> 1fr animates the height from 0 to auto without a
          hard-coded max height. The links stay in the page when closed. */}
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'mb-1 mt-0.5 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-0.5">
            {section.leaves.map((leaf) => (
              <NavLink
                key={leaf.item.to}
                to={leaf.item.to}
                end={leaf.exact}
                className={({ isActive }) => `${ROW} pl-11 ${isActive ? ROW_ACTIVE : 'text-white/70'}`}
              >
                <span>{leaf.item.label}</span>
                {leaf.item.badge && <Badge text={leaf.item.badge} />}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  const auth = useAuth();
  const { visibleFeatures, status } = useVisibleFeatures();

  // Two independent filters, both UX only (the server enforces each):
  //  - network partners lose the whole tenant-planning side (lib/partnerAccess,
  //    tracks the RouteBuilder.* policies; App.tsx guards the same routes -
  //    see NP-PAY-PART4-TODO.md T2/T3);
  //  - every entry is behind its Access Control switch. A group's key hides
  //    the whole group; a group left with no visible pages is dropped. DF
  //    Admin bypasses the switches, as [RequireFeature] does on the server.
  const visibleItems = useMemo(() => {
    const allowed = auth.bypassesFeatureSwitches ? () => true : makeFeatureAllowed(status, visibleFeatures);
    return navItems
      .filter((item) => !item.hidden)
      .filter((item) => !(auth.isNetworkPartner && isPartnerDeniedPath(item.to)))
      .filter((item) => allowed(item.featureKey))
      .map((item): NavItem => item.children
        ? { ...item, children: item.children.filter((c) => !c.hidden && allowed(c.featureKey)) }
        : item)
      .filter((item) => !item.children || item.children.length > 0);
  }, [auth.isNetworkPartner, auth.bypassesFeatureSwitches, status, visibleFeatures]);

  const home = visibleItems.find((item) => item.to === HOME_PATH && !item.children);

  // Arrange the visible pages into the sections.
  const sections = useMemo(() => {
    const leavesOf = (item: NavItem): MenuLeaf[] => item.children
      ? item.children.map((child) => ({ item: child, exact: child.to === item.to }))
      : [{ item, exact: false }];
    const placed = new Set<string>([HOME_PATH]);
    const built: VisibleSection[] = SECTIONS.map((section) => {
      const leaves = section.paths.flatMap((path) => {
        const item = visibleItems.find((candidate) => candidate.to === path);
        if (!item) return [];
        placed.add(item.to);
        return leavesOf(item);
      });
      return { ...section, leaves };
    });
    const unplaced = visibleItems.filter((item) => !placed.has(item.to)).flatMap(leavesOf);
    return built
      .map((section) => section.id === CATCH_ALL_SECTION ? { ...section, leaves: [...section.leaves, ...unplaced] } : section)
      .filter((section) => section.leaves.length > 0);
  }, [visibleItems]);

  const currentSectionId = sections.find((section) =>
    section.leaves.some((leaf) => isOnPage(location.pathname, leaf)))?.id ?? null;

  // A section starts open only when it holds the current page, and moving to
  // a page in another section opens that one. What the person opens or closes
  // by hand stays as they left it.
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentSectionId ? [currentSectionId] : []));
  useEffect(() => {
    if (currentSectionId) setOpen((prev) => (prev.has(currentSectionId) ? prev : new Set(prev).add(currentSectionId)));
  }, [currentSectionId]);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="flex w-60 flex-col bg-brand-dark text-white">
      <div className="border-b border-white/10 px-4 py-4">
        <div className="text-base font-bold leading-tight">Routed Operations</div>
        <div className="mt-0.5 text-xs font-light text-white/70">Runs, routes and schedules</div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
        {home && (
          <NavLink to={home.to} className={({ isActive }) => `${ROW} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}>
            <RoIcon name="home" className="h-5 w-5 flex-none" />
            <span>{home.label}</span>
          </NavLink>
        )}
        {sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            open={open.has(section.id)}
            onToggle={() => toggle(section.id)}
            holdsCurrentPage={section.id === currentSectionId}
          />
        ))}
      </nav>
    </aside>
  );
}
