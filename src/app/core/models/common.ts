/** Ids are opaque strings everywhere. Seeded ids are readable on purpose
 *  (`land-3`, `agr-2`) so a screenshot or a URL says what it is. */
export type Id = string;

/** Presentational vocabulary shared by status-badge, kpi-tile, data-table and
 *  alert. This is the ONLY thing `shared/ui` may import from `core`: it
 *  describes appearance, not the domain. */
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'brand';

export type RoleName = 'admin' | 'owner' | 'sharecropper';

export const ROLE_LABELS: Record<RoleName, string> = {
  admin: 'Administrator',
  owner: 'Land Owner',
  sharecropper: 'Sharecropper (Bargadar)',
};

/** Self-service Owner/Sharecropper signups start 'pending' until an Admin
 *  approves them; Admin signup (gated by the invite code) and every party
 *  an Admin creates directly both go straight to 'active'. */
export type PartyStatus = 'pending' | 'active' | 'rejected';

export const PARTY_STATUS_LABELS: Record<PartyStatus, string> = {
  pending: 'Pending approval',
  active: 'Active',
  rejected: 'Rejected',
};

/**
 * Every date in the seed is derived from this anchor with `addDays`. No
 * `new Date()` at module scope: the mock database must produce the same numbers
 * on every reload, or a screenshot stops meaning anything and a test that
 * passes in the morning fails in the evening.
 */
export const SEASON_ANCHOR = '2025-06-15';

export function addDays(iso: string, days: number): string {
  const base = new Date(`${iso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** Bangladesh Taka. Whole taka only — agricultural settlements here are not
 *  quoted in poisha. */
export function formatTaka(amount: number): string {
  return `৳ ${Math.round(amount).toLocaleString('en-IN')}`;
}

/** Land is measured in decimals locally (100 decimal = 1 acre ≈ 33 shatak per
 *  bigha in this district). Kept as decimals throughout to avoid a conversion
 *  the seed data cannot justify. */
export function formatArea(decimals: number): string {
  return `${decimals.toLocaleString('en-IN')} decimal`;
}

export function formatMaund(quantity: number): string {
  return `${quantity.toLocaleString('en-IN')} maund`;
}

/** dd/MM/yyyy — the format every printed form in this domain uses. */
export function formatDate(iso: string): string {
  if (!iso) {
    return '—';
  }
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
