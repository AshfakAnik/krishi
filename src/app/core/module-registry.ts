import { RoleName } from './models/common';

export interface ModuleEntry {
  path: string;
  label: string;
  group: string;
  icon: string;
  blurb: string;
  /** Who may see the link and follow it. The sidebar filters on this and
   *  `roleGuard` enforces the same list, so a hidden module is unreachable by
   *  URL as well as invisible in the nav. */
  roles: RoleName[];
  /** False until the module is built. Renders the stub page, which names what
   *  is planned rather than 404-ing. */
  built?: boolean;
}

/**
 * The nav, and the lane structure of the activity diagram, in one list.
 * Groups follow the diagram's five lanes so the app reads as the same system
 * the analyst drew.
 */
export const MODULES: ModuleEntry[] = [
  // Lane 1 — Authentication & cultivation setup
  {
    path: 'seasons',
    label: 'Seasons',
    group: 'Setup',
    icon: 'calendar',
    blurb: 'Aus, Aman and Boro season windows a cultivation cycle may start inside.',
    roles: ['admin', 'owner'],
    built: true,
  },
  {
    path: 'lands',
    label: 'Lands',
    group: 'Setup',
    icon: 'layers',
    blurb: 'Dag-wise plots with area, land type (Dhani / Vita) and current holder.',
    roles: ['admin', 'owner'],
    built: true,
  },
  {
    path: 'crops',
    label: 'Crops & Varieties',
    group: 'Setup',
    icon: 'leaf',
    blurb: 'Crops, the land types they suit, and their varieties with expected yields.',
    roles: ['admin', 'owner'],
    built: true,
  },
  {
    path: 'people',
    label: 'Owners & Sharecroppers',
    group: 'Setup',
    icon: 'users',
    blurb: 'Parties to an agreement: land owners, sharecroppers and staff.',
    roles: ['admin'],
    built: true,
  },

  // Lane 2 — Farming type & sharecropping agreement
  {
    path: 'agreements',
    label: 'Sharecropping Agreements',
    group: 'Agreements',
    icon: 'receipt',
    blurb: 'Draft, approve, activate and revoke Normal and Tevaga agreements.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'advances',
    label: 'Advances & Loans',
    group: 'Agreements',
    icon: 'coins',
    blurb: 'Dadhon ledger per sharecropper, drawn down at settlement.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },

  // Lane 3 — Crop lifecycle & farming activities
  {
    path: 'cycles',
    label: 'Cultivation Cycles',
    group: 'Cultivation',
    icon: 'timer',
    blurb: 'One cycle per land per season, created when an agreement activates.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'calendar',
    label: 'Farming Calendar',
    group: 'Cultivation',
    icon: 'calendar',
    blurb: 'Lifecycle template expanded into scheduled activities and reminders.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'activities',
    label: 'Farming Activities',
    group: 'Cultivation',
    icon: 'list',
    blurb: 'Fertiliser, irrigation, weeding, pesticide — with cost responsibility.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'monitoring',
    label: 'Crop Monitoring',
    group: 'Cultivation',
    icon: 'gauge',
    blurb: 'AI monitoring, damage logging and force-majeure yield adjustment.',
    roles: ['admin', 'owner'],
    built: true,
  },

  // Lane 4 — Harvest, post-harvest, storage & sales
  {
    path: 'harvests',
    label: 'Harvests',
    group: 'Harvest & Sales',
    icon: 'box',
    blurb: 'Harvest events, labour, quantity, quality and price grade.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'post-harvest',
    label: 'Post-Harvest',
    group: 'Harvest & Sales',
    icon: 'sliders',
    blurb: 'Drying, Pala stacking, threshing, machine processing and jute retting.',
    roles: ['admin', 'owner'],
    built: true,
  },
  {
    path: 'inventory',
    label: 'Storage & Inventory',
    group: 'Harvest & Sales',
    icon: 'layers',
    blurb: 'Stored stock, wastage adjustment and in-kind split inventories.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'sales',
    label: 'Sales',
    group: 'Harvest & Sales',
    icon: 'tag',
    blurb: 'Batch sales, gross sales, market haque, transport and net sale.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },

  // Lane 5 — Settlement, financial accounting & reporting
  {
    path: 'settlements',
    label: 'Settlements',
    group: 'Settlement & Finance',
    icon: 'scale',
    blurb: 'Pooled, in-kind and partial-season settlement with advance deduction.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'disputes',
    label: 'Disputes',
    group: 'Settlement & Finance',
    icon: 'alert',
    blurb: 'Reconciliation review, routed back to the right recomputation point.',
    roles: ['admin', 'owner', 'sharecropper'],
    built: true,
  },
  {
    path: 'finance',
    label: 'Finance',
    group: 'Settlement & Finance',
    icon: 'coins',
    blurb: 'Receivables, payables, payments and product transfers.',
    roles: ['admin', 'owner'],
    built: true,
  },
  {
    path: 'reports',
    label: 'Reports',
    group: 'Settlement & Finance',
    icon: 'grid',
    blurb: 'Land-wise, sharecropper-wise, crop-wise, season-wise and P&L reports.',
    roles: ['admin', 'owner'],
    built: true,
  },
  {
    path: 'audit',
    label: 'Audit Trail',
    group: 'Settlement & Finance',
    icon: 'shield',
    blurb: 'Every write in the app, with actor, module and detail.',
    roles: ['admin'],
    built: true,
  },
];

export const MODULE_GROUPS = [
  'Setup',
  'Agreements',
  'Cultivation',
  'Harvest & Sales',
  'Settlement & Finance',
] as const;

export function modulesFor(role: RoleName | null): ModuleEntry[] {
  return role ? MODULES.filter((entry) => entry.roles.includes(role)) : [];
}
