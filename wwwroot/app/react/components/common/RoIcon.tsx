// Icons for the Routed Operations home page cards and side menu. Outline style to the
// DFRNT brand guide (24px grid, stroke 1.25, round caps and joins), drawn
// inline so the page needs no icon package. Decorative only: every icon is
// aria-hidden and the card's own text is its accessible name.
import type { ReactNode } from 'react';

export type RoIconName =
  | 'route' | 'plane' | 'scan' | 'print' | 'headset'
  | 'repeat' | 'calendar' | 'sliders' | 'users' | 'polygon'
  | 'upload' | 'map' | 'calculator' | 'checklist' | 'archive'
  | 'home' | 'tools' | 'box' | 'truck' | 'alert';

const PATHS: Record<RoIconName, ReactNode> = {
  route: (<><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H12" /></>),
  plane: (<path d="M16 10h4a2 2 0 0 1 0 4h-4l-4 7H9l2-7H7l-2 2H2l2-4-2-4h3l2 2h4L9 3h3z" />),
  scan: (<path d="M4 7V6a2 2 0 0 1 2-2h2M4 17v1a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v1M16 20h2a2 2 0 0 0 2-2v-1M5 11h1v2H5zM10 11v2M14 11h1v2h-1zM19 11v2" />),
  print: (<><path d="M17 17h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2M17 9V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v4" /><rect x="7" y="13" width="10" height="8" rx="2" /></>),
  headset: (<><rect x="4" y="13" width="4" height="6" rx="2" /><rect x="16" y="13" width="4" height="6" rx="2" /><path d="M4 15v-3a8 8 0 0 1 16 0v3M18 19a6 3 0 0 1-6 3" /></>),
  repeat: (<path d="M4 12V9a3 3 0 0 1 3-3h13m-3-3 3 3-3 3M20 12v3a3 3 0 0 1-3 3H4m3 3-3-3 3-3" />),
  calendar: (<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M16 3v4M8 3v4M4 11h16M8 15h2v2H8z" /></>),
  sliders: (<><circle cx="14" cy="6" r="2" /><path d="M4 6h8M16 6h4" /><circle cx="8" cy="12" r="2" /><path d="M4 12h2M10 12h10" /><circle cx="17" cy="18" r="2" /><path d="M4 18h11M19 18h1" /></>),
  users: (<><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" /></>),
  polygon: (<><circle cx="12" cy="5" r="2" /><circle cx="19" cy="8" r="2" /><circle cx="5" cy="11" r="2" /><circle cx="15" cy="19" r="2" /><path d="M6.5 9.5 10.5 6M14 5.5l3 1.5M18.5 10 16 17M13.5 17.5l-7-5" /></>),
  upload: (<><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM12 11v6M9.5 13.5 12 11l2.5 2.5" /></>),
  map: (<path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13" />),
  calculator: (<><rect x="4" y="3" width="16" height="18" rx="2" /><rect x="8" y="7" width="8" height="3" rx="1" /><path d="M8 14v.01M12 14v.01M16 14v.01M8 17v.01M12 17v.01M16 17v.01" /></>),
  checklist: (<path d="M3.5 5.5 5 7l2.5-2.5M3.5 11.5 5 13l2.5-2.5M3.5 17.5 5 19l2.5-2.5M11 6h9M11 12h9M11 18h9" />),
  home: (<path d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6" />),
  tools: (<path d="M7 10h3V7L6.5 3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1-3 3l-6-6a6 6 0 0 1-8-8z" />),
  box: (<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5" />),
  truck: (<><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M5 17H3V6a1 1 0 0 1 1-1h9v12m-4 0h6m4 0h2v-6h-8m0-5h5l3 5" /></>),
  alert: (<path d="M12 9v4M12 17h.01M10.24 3.957 2.257 17.125A2 2 0 0 0 3.986 20h16.028a2 2 0 0 0 1.729-2.875L13.76 3.957a2 2 0 0 0-3.52 0z" />),
  archive: (<><rect x="3" y="4" width="18" height="4" rx="2" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" /></>),
};

export function RoIcon({ name, className = 'h-9 w-9' }: { name: RoIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
