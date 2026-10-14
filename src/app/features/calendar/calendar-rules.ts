import { CropVariety } from '../../core/models/agriculture';
import { addDays, daysBetween } from '../../core/models/common';
import { CalendarTask, CropStage, CultivationCycle } from '../../core/models/cultivation';

/**
 * Every rule of the Farming Calendar module, as plain functions over plain data.
 * No `inject`, no signals, no store, no Angular import.
 *
 * The module's reason to exist is the template: a cycle should arrive with its
 * whole season already laid out, because a calendar somebody has to fill in by
 * hand is a calendar nobody fills in.
 */

/** A task within a lifecycle stage, placed as a fraction of the variety's own
 *  growing period rather than at a fixed day. A 90-day potato and a 145-day
 *  paddy do not share a calendar, but they share a shape. */
export interface TemplateStep {
  stage: CropStage;
  name: string;
  /** 0 is sowing day, 1 is harvest day. */
  at: number;
}

/**
 * The lifecycle template, in order. Deliberately short: every step here is one
 * somebody would actually be reminded about, and a template padded with steps
 * nobody closes trains people to ignore the whole calendar.
 */
export const LIFECYCLE_TEMPLATE: TemplateStep[] = [
  { stage: 'land-prep', name: 'Ploughing and laddering', at: -0.06 },
  { stage: 'sowing', name: 'Transplant seedlings', at: 0 },
  { stage: 'vegetative', name: 'First urea top-dressing', at: 0.14 },
  { stage: 'vegetative', name: 'First weeding', at: 0.2 },
  { stage: 'vegetative', name: 'Second weeding', at: 0.28 },
  { stage: 'flowering', name: 'Irrigation before panicle initiation', at: 0.38 },
  { stage: 'flowering', name: 'Second top-dressing', at: 0.45 },
  { stage: 'ripening', name: 'Pest and disease check', at: 0.62 },
  { stage: 'ripening', name: 'Bird and rodent watch', at: 0.72 },
  { stage: 'harvest', name: 'Cut, bundle and carry to the Pala', at: 1 },
];

/** Tasks still waiting on somebody. A skipped task is closed, not outstanding. */
export function isOpen(task: CalendarTask): boolean {
  return task.status === 'due';
}

/**
 * Expands the template against a cycle.
 *
 * Offsets scale with the variety's `durationDays`, so the calendar fits the crop
 * rather than the other way round. Returns tasks in due order.
 */
export function generateCalendar(
  cycle: CultivationCycle,
  variety: CropVariety | undefined,
  idFor: (index: number) => string,
): CalendarTask[] {
  const duration = variety?.durationDays ?? 120;
  return LIFECYCLE_TEMPLATE.map((step, index) => ({
    id: idFor(index),
    cycleId: cycle.id,
    stage: step.stage,
    name: step.name,
    dueOn: addDays(cycle.startedOn, Math.round(step.at * duration)),
    status: 'due' as const,
    closedOn: '',
    note: '',
  }));
}

export type TaskStanding = 'overdue' | 'due-soon' | 'upcoming' | 'closed';

/** How urgent a task is, read from the dates rather than stored — a stored
 *  "overdue" flag is wrong the morning after it becomes true. */
export function taskStanding(task: CalendarTask, today: string): TaskStanding {
  if (task.status !== 'due') {
    return 'closed';
  }
  if (task.dueOn < today) {
    return 'overdue';
  }
  return daysBetween(today, task.dueOn) <= 7 ? 'due-soon' : 'upcoming';
}

export function overdueCount(tasks: CalendarTask[], today: string): number {
  return tasks.filter((task) => taskStanding(task, today) === 'overdue').length;
}

/** The next thing anybody has to do on this cycle. */
export function nextDue(tasks: CalendarTask[]): CalendarTask | null {
  return tasks.filter(isOpen).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null;
}

export function complete(task: CalendarTask, on: string, note: string): CalendarTask {
  return { ...task, status: 'done', closedOn: on, note: note.trim() || task.note };
}

/** Skipping is not completing: a step that did not need doing has to be
 *  distinguishable from one that was done, or the record lies about the field. */
export function skip(task: CalendarTask, on: string, note: string): CalendarTask {
  return { ...task, status: 'skipped', closedOn: on, note: note.trim() || task.note };
}

/** The inverse of both. Reopening restores a task exactly, including clearing
 *  the closing date — a `due` task carrying one would sort and read wrongly. */
export function reopen(task: CalendarTask): CalendarTask {
  return { ...task, status: 'due', closedOn: '' };
}

export interface TaskDraft {
  cycleId: string;
  stage: CropStage;
  name: string;
  dueOn: string;
}

export function validateTask(
  draft: TaskDraft,
  context: { cycles: CultivationCycle[] },
): Record<string, string> {
  const errors: Record<string, string> = {};

  const cycle = context.cycles.find((row) => row.id === draft.cycleId);
  if (!draft.cycleId) {
    errors['cycleId'] = 'Select the cycle this task belongs to.';
  } else if (!cycle) {
    errors['cycleId'] = 'That cycle no longer exists.';
  } else if (cycle.status === 'settled' || cycle.status === 'aborted') {
    errors['cycleId'] = `${cycle.reference} has finished; nothing more is due on it.`;
  }

  if (draft.name.trim().length < 3) {
    errors['name'] = 'Say what has to be done.';
  }

  if (!draft.dueOn) {
    errors['dueOn'] = 'Give the date it is due.';
  } else if (cycle && draft.dueOn < cycle.startedOn) {
    errors['dueOn'] = `${cycle.reference} starts on ${cycle.startedOn}; a task cannot predate it.`;
  }

  return errors;
}

export function taskFromDraft(draft: TaskDraft, id: string): CalendarTask {
  return {
    id,
    cycleId: draft.cycleId,
    stage: draft.stage,
    name: draft.name.trim(),
    dueOn: draft.dueOn,
    status: 'due',
    closedOn: '',
    note: '',
  };
}
