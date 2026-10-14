import { ADVANCES, AGREEMENTS, CULTIVATION_CYCLES } from './seed/agreements';
import { AUDIT_LOGS } from './seed/audit';
import { HARVESTS, PROCESSING_BATCHES, SALES, STOCK_LOTS } from './seed/harvest';
import { CALENDAR_TASKS, FARMING_ACTIVITIES, MONITORING_LOGS } from './seed/lifecycle';
import { DISPUTES, FINANCE_ENTRIES, SETTLEMENTS } from './seed/settlement';
import { CROPS, CROP_VARIETIES, LANDS, PARTIES, SEASONS } from './seed/reference';

/**
 * One object, one key per collection. `MockApiService` clones this once at
 * construction and serves the clone, so writes survive navigation and reset on
 * reload.
 *
 * The `satisfies` clause forces every collection to be an array of rows with an
 * `id`, which is exactly what `@ngrx/entity` assumes.
 */
export const MOCK_DB = {
  seasons: SEASONS,
  lands: LANDS,
  crops: CROPS,
  cropVarieties: CROP_VARIETIES,
  parties: PARTIES,
  agreements: AGREEMENTS,
  cultivationCycles: CULTIVATION_CYCLES,
  advances: ADVANCES,
  calendarTasks: CALENDAR_TASKS,
  farmingActivities: FARMING_ACTIVITIES,
  monitoringLogs: MONITORING_LOGS,
  harvests: HARVESTS,
  processingBatches: PROCESSING_BATCHES,
  stockLots: STOCK_LOTS,
  sales: SALES,
  settlements: SETTLEMENTS,
  disputes: DISPUTES,
  financeEntries: FINANCE_ENTRIES,
  auditLogs: AUDIT_LOGS,
} satisfies Record<string, { id: string }[]>;

export type CollectionKey = keyof typeof MOCK_DB;
