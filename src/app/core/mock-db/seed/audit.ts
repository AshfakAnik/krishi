import { AuditLogRow } from '../../audit-log';
import { SEASON_ANCHOR, addDays } from '../../models/common';

/** Enough history that the audit page is not empty on first load. Everything
 *  after this is written by the app itself, one row per write. */
export const AUDIT_LOGS: AuditLogRow[] = [
  {
    id: 'audit-seed-1',
    actorRole: 'owner',
    actorName: 'Ashfakul Alam',
    action: 'Submitted agreement for approval',
    moduleName: 'Sharecropping Agreements',
    details: 'BRG-2025-001 · Abdul Malek · Boro Dhani Beel',
    timestamp: `${addDays(SEASON_ANCHOR, -6)} 09:20`,
  },
  {
    id: 'audit-seed-2',
    actorRole: 'admin',
    actorName: 'Rezaul Karim',
    action: 'Approved and activated agreement',
    moduleName: 'Sharecropping Agreements',
    details: 'BRG-2025-001 · cycle CYC-2025-001 created · advance ৳ 15,000 recorded',
    timestamp: `${addDays(SEASON_ANCHOR, -3)} 11:05`,
  },
  {
    id: 'audit-seed-3',
    actorRole: 'admin',
    actorName: 'Rezaul Karim',
    action: 'Approved and activated agreement',
    moduleName: 'Sharecropping Agreements',
    details: 'BRG-2025-002 · Tevaga, 1 of 3 shares · cycle CYC-2025-002 created',
    timestamp: `${addDays(SEASON_ANCHOR, -1)} 16:42`,
  },
  {
    id: 'audit-seed-4',
    actorRole: 'admin',
    actorName: 'Rezaul Karim',
    action: 'Rejected agreement',
    moduleName: 'Sharecropping Agreements',
    details: 'BRG-2025-004 · Monir Hossain · half-share Tevaga outside local practice',
    timestamp: `${addDays(SEASON_ANCHOR, 1)} 10:15`,
  },
  {
    id: 'audit-seed-5',
    actorRole: 'owner',
    actorName: 'Ashfakul Alam',
    action: 'Recorded mid-season advance',
    moduleName: 'Advances & Loans',
    details: 'BRG-2025-001 · Abdul Malek · ৳ 5,000 for urea top-dressing',
    timestamp: `${addDays(SEASON_ANCHOR, 41)} 08:30`,
  },
];
