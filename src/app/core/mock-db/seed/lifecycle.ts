import { SEASON_ANCHOR, addDays } from '../../models/common';
import { CalendarTask, FarmingActivity, MonitoringLog } from '../../models/cultivation';

/**
 * Lane 3's seeded history, hung off the two live seed cycles.
 *
 * `cyc-1` (Boro Dhani Beel, BR-11 under BRG-2025-001) is the worked example: it
 * has a full calendar, four recorded activities showing each way a cost can be
 * borne, and a pest observation that took its expected yield down. `cyc-2` is
 * left thinner on purpose, so the empty-ish case is visible too.
 */

export const CALENDAR_TASKS: CalendarTask[] = [
  {
    id: 'task-1',
    cycleId: 'cyc-1',
    stage: 'land-prep',
    name: 'Ploughing and laddering',
    dueOn: addDays(SEASON_ANCHOR, 2),
    status: 'done',
    closedOn: addDays(SEASON_ANCHOR, 3),
    note: 'Two passes with a power tiller.',
  },
  {
    id: 'task-2',
    cycleId: 'cyc-1',
    stage: 'sowing',
    name: 'Transplant seedlings',
    dueOn: addDays(SEASON_ANCHOR, 12),
    status: 'done',
    closedOn: addDays(SEASON_ANCHOR, 13),
    note: '',
  },
  {
    id: 'task-3',
    cycleId: 'cyc-1',
    stage: 'vegetative',
    name: 'First urea top-dressing',
    dueOn: addDays(SEASON_ANCHOR, 32),
    status: 'done',
    closedOn: addDays(SEASON_ANCHOR, 33),
    note: '',
  },
  {
    id: 'task-4',
    cycleId: 'cyc-1',
    stage: 'vegetative',
    name: 'Second weeding',
    dueOn: addDays(SEASON_ANCHOR, 40),
    status: 'skipped',
    closedOn: addDays(SEASON_ANCHOR, 41),
    note: 'Weed pressure low after the first pass.',
  },
  {
    id: 'task-5',
    cycleId: 'cyc-1',
    stage: 'flowering',
    name: 'Irrigation before panicle initiation',
    dueOn: addDays(SEASON_ANCHOR, 55),
    status: 'due',
    closedOn: '',
    note: '',
  },
  {
    id: 'task-6',
    cycleId: 'cyc-1',
    stage: 'ripening',
    name: 'Bird and rodent watch',
    dueOn: addDays(SEASON_ANCHOR, 105),
    status: 'due',
    closedOn: '',
    note: '',
  },
  {
    id: 'task-7',
    cycleId: 'cyc-1',
    stage: 'harvest',
    name: 'Cut, bundle and carry to the Pala',
    dueOn: addDays(SEASON_ANCHOR, 145),
    status: 'due',
    closedOn: '',
    note: '',
  },
  {
    id: 'task-8',
    cycleId: 'cyc-2',
    stage: 'land-prep',
    name: 'Ploughing and laddering',
    dueOn: addDays(SEASON_ANCHOR, 4),
    status: 'done',
    closedOn: addDays(SEASON_ANCHOR, 5),
    note: '',
  },
  {
    id: 'task-9',
    cycleId: 'cyc-2',
    stage: 'sowing',
    name: 'Transplant seedlings',
    dueOn: addDays(SEASON_ANCHOR, 14),
    status: 'done',
    closedOn: addDays(SEASON_ANCHOR, 15),
    note: '',
  },
  {
    id: 'task-10',
    cycleId: 'cyc-2',
    stage: 'vegetative',
    name: 'First urea top-dressing',
    dueOn: addDays(SEASON_ANCHOR, 34),
    status: 'due',
    closedOn: '',
    note: '',
  },
];

/**
 * One activity per way a cost can fall, so the responsibility split is legible
 * from the seed alone: BRG-2025-001 is Normal with shared cost, sharecropper
 * labour, owner machinery and shared inputs.
 */
export const FARMING_ACTIVITIES: FarmingActivity[] = [
  {
    id: 'act-1',
    reference: 'ACT-2025-001',
    cycleId: 'cyc-1',
    kind: 'ploughing',
    costLine: 'machinery',
    performedOn: addDays(SEASON_ANCHOR, 3),
    amount: 4200,
    note: 'Power tiller hire, two passes.',
    bearer: 'owner',
    ownerShare: 4200,
    sharecropperShare: 0,
  },
  {
    id: 'act-2',
    reference: 'ACT-2025-002',
    cycleId: 'cyc-1',
    kind: 'sowing',
    costLine: 'labour',
    performedOn: addDays(SEASON_ANCHOR, 13),
    amount: 3600,
    note: 'Six labourers for transplanting.',
    bearer: 'sharecropper',
    ownerShare: 0,
    sharecropperShare: 3600,
  },
  {
    id: 'act-3',
    reference: 'ACT-2025-003',
    cycleId: 'cyc-1',
    kind: 'fertiliser',
    costLine: 'input',
    performedOn: addDays(SEASON_ANCHOR, 33),
    amount: 5000,
    note: 'Urea, first top-dressing.',
    bearer: 'shared',
    ownerShare: 2500,
    sharecropperShare: 2500,
  },
  {
    id: 'act-4',
    reference: 'ACT-2025-004',
    cycleId: 'cyc-1',
    kind: 'pesticide',
    costLine: 'input',
    performedOn: addDays(SEASON_ANCHOR, 44),
    amount: 1800,
    note: 'Stem borer control after the field visit.',
    bearer: 'shared',
    ownerShare: 900,
    sharecropperShare: 900,
  },
  {
    id: 'act-5',
    reference: 'ACT-2025-005',
    cycleId: 'cyc-2',
    kind: 'irrigation',
    costLine: 'other',
    performedOn: addDays(SEASON_ANCHOR, 36),
    amount: 6000,
    note: 'Diesel for the shallow pump.',
    // Tevaga: the sharecropper bears the entire cultivation cost.
    bearer: 'sharecropper',
    ownerShare: 0,
    sharecropperShare: 6000,
  },
];

/**
 * `mon-3` is the one that matters: a pest attack that took cyc-1's expected
 * yield from 82 down to 74 maund. Both figures are stored, so the adjustment can
 * be read back and reversed.
 */
export const MONITORING_LOGS: MonitoringLog[] = [
  {
    id: 'mon-1',
    reference: 'OBS-2025-001',
    cycleId: 'cyc-1',
    observedOn: addDays(SEASON_ANCHOR, 20),
    kind: 'ai-scan',
    stage: 'vegetative',
    cause: 'none',
    damagePercent: 0,
    note: 'Canopy even, no stress signature.',
    yieldBefore: 82,
    yieldAfter: 82,
    observedBy: 'Rezaul Karim',
  },
  {
    id: 'mon-2',
    reference: 'OBS-2025-002',
    cycleId: 'cyc-1',
    observedOn: addDays(SEASON_ANCHOR, 42),
    kind: 'field-visit',
    stage: 'vegetative',
    cause: 'pest',
    damagePercent: 0,
    note: 'Stem borer seen in the north corner. Treatment advised, no loss yet.',
    yieldBefore: 82,
    yieldAfter: 82,
    observedBy: 'Ashfakul Alam',
  },
  {
    id: 'mon-3',
    reference: 'OBS-2025-003',
    cycleId: 'cyc-1',
    observedOn: addDays(SEASON_ANCHOR, 46),
    kind: 'damage-report',
    stage: 'vegetative',
    cause: 'pest',
    damagePercent: 10,
    note: 'Roughly a tenth of the crop lost to stem borer before treatment took.',
    yieldBefore: 82,
    yieldAfter: 74,
    observedBy: 'Rezaul Karim',
  },
  {
    id: 'mon-4',
    reference: 'OBS-2025-004',
    cycleId: 'cyc-2',
    observedOn: addDays(SEASON_ANCHOR, 30),
    kind: 'ai-scan',
    stage: 'vegetative',
    cause: 'none',
    damagePercent: 0,
    note: 'Healthy stand across the plot.',
    yieldBefore: 122,
    yieldAfter: 122,
    observedBy: 'Rezaul Karim',
  },
];
