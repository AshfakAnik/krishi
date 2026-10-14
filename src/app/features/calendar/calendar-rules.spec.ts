import { describe, expect, it } from 'vitest';
import { CropVariety } from '../../core/models/agriculture';
import { CalendarTask, CultivationCycle } from '../../core/models/cultivation';
import {
  LIFECYCLE_TEMPLATE,
  TaskDraft,
  complete,
  generateCalendar,
  isOpen,
  nextDue,
  overdueCount,
  reopen,
  skip,
  taskStanding,
  validateTask,
} from './calendar-rules';

const cycle = (o: Partial<CultivationCycle> = {}): CultivationCycle => ({
  id: 'cyc-1',
  reference: 'CYC-2025-001',
  landId: 'land-1',
  seasonId: 'season-aman-2025',
  cropId: 'crop-paddy',
  varietyId: 'var-br11',
  farmingType: 'sharecropping',
  agreementId: 'agr-1',
  sharecropperId: 'party-sc-1',
  startedOn: '2025-06-17',
  status: 'ongoing',
  expectedYield: 82,
  ...o,
});

const variety = (o: Partial<CropVariety> = {}): CropVariety => ({
  id: 'var-br11',
  cropId: 'crop-paddy',
  name: 'BR-11',
  durationDays: 145,
  expectedYieldPerDecimal: 0.62,
  ...o,
});

const task = (o: Partial<CalendarTask> = {}): CalendarTask => ({
  id: 'task-1',
  cycleId: 'cyc-1',
  stage: 'vegetative',
  name: 'First weeding',
  dueOn: '2025-07-20',
  status: 'due',
  closedOn: '',
  note: '',
  ...o,
});

const draft = (o: Partial<TaskDraft> = {}): TaskDraft => ({
  cycleId: 'cyc-1',
  stage: 'vegetative',
  name: 'Extra weeding pass',
  dueOn: '2025-07-25',
  ...o,
});

describe('expanding the template', () => {
  const idFor = (index: number) => `task-${index}`;

  it('produces one task per template step', () => {
    expect(generateCalendar(cycle(), variety(), idFor)).toHaveLength(LIFECYCLE_TEMPLATE.length);
  });

  it('scales the calendar to the variety rather than to a fixed day count', () => {
    // A 90-day potato and a 145-day paddy do not share a calendar.
    const long = generateCalendar(cycle(), variety({ durationDays: 145 }), idFor);
    const short = generateCalendar(cycle(), variety({ durationDays: 90 }), idFor);
    expect(long.at(-1)!.dueOn).toBe('2025-11-09');
    expect(short.at(-1)!.dueOn).toBe('2025-09-15');
  });

  it('puts land preparation before the cycle starts, and harvest at the end', () => {
    const tasks = generateCalendar(cycle(), variety(), idFor);
    expect(tasks[0].stage).toBe('land-prep');
    expect(tasks[0].dueOn < cycle().startedOn).toBe(true);
    expect(tasks.at(-1)!.stage).toBe('harvest');
  });

  it('opens every task as due, with nothing closed', () => {
    const tasks = generateCalendar(cycle(), variety(), idFor);
    expect(tasks.every((row) => row.status === 'due' && row.closedOn === '')).toBe(true);
  });

  it('falls back to a sane duration when the variety is missing', () => {
    expect(generateCalendar(cycle(), undefined, idFor)).toHaveLength(LIFECYCLE_TEMPLATE.length);
  });
});

describe('how urgent a task is', () => {
  it('reads from the dates, not from a stored flag', () => {
    expect(taskStanding(task({ dueOn: '2025-07-10' }), '2025-07-20')).toBe('overdue');
    expect(taskStanding(task({ dueOn: '2025-07-22' }), '2025-07-20')).toBe('due-soon');
    expect(taskStanding(task({ dueOn: '2025-07-27' }), '2025-07-20')).toBe('due-soon');
    expect(taskStanding(task({ dueOn: '2025-07-28' }), '2025-07-20')).toBe('upcoming');
  });

  it('calls a closed task closed, however overdue it once was', () => {
    expect(taskStanding(task({ dueOn: '2025-01-01', status: 'done' }), '2025-07-20')).toBe(
      'closed',
    );
    expect(taskStanding(task({ dueOn: '2025-01-01', status: 'skipped' }), '2025-07-20')).toBe(
      'closed',
    );
  });

  it('counts only what is genuinely late', () => {
    const tasks = [
      task({ id: 'a', dueOn: '2025-07-01' }),
      task({ id: 'b', dueOn: '2025-07-02', status: 'done' }),
      task({ id: 'c', dueOn: '2025-08-01' }),
    ];
    expect(overdueCount(tasks, '2025-07-20')).toBe(1);
  });

  it('finds the next thing anybody has to do', () => {
    const tasks = [
      task({ id: 'a', dueOn: '2025-08-01' }),
      task({ id: 'b', dueOn: '2025-07-01', status: 'done' }),
      task({ id: 'c', dueOn: '2025-07-15' }),
    ];
    expect(nextDue(tasks)?.id).toBe('c');
    expect(nextDue([task({ status: 'done' })])).toBeNull();
  });
});

describe('closing and reopening a task', () => {
  it('records completion with its date', () => {
    const done = complete(task(), '2025-07-21', 'Two labourers.');
    expect(done).toMatchObject({ status: 'done', closedOn: '2025-07-21', note: 'Two labourers.' });
    expect(isOpen(done)).toBe(false);
  });

  it('keeps skipped distinguishable from done', () => {
    // A step that did not need doing must not read as one that was done.
    const skipped = skip(task(), '2025-07-21', 'Weed pressure low.');
    expect(skipped.status).toBe('skipped');
    expect(isOpen(skipped)).toBe(false);
  });

  it('keeps the existing note when no new one is given', () => {
    expect(complete(task({ note: 'Original' }), '2025-07-21', '   ').note).toBe('Original');
  });

  it('reopens exactly, clearing the closing date', () => {
    // A `due` task carrying a closing date would sort and read wrongly.
    const original = task();
    expect(reopen(complete(original, '2025-07-21', ''))).toEqual(original);
    expect(reopen(skip(original, '2025-07-21', ''))).toEqual(original);
  });
});

describe('adding a task by hand', () => {
  const context = { cycles: [cycle()] };

  it('accepts a complete draft', () => {
    expect(validateTask(draft(), context)).toEqual({});
  });

  it('needs a live cycle', () => {
    expect(validateTask(draft({ cycleId: '' }), context)).toHaveProperty('cycleId');
    expect(validateTask(draft({ cycleId: 'cyc-9' }), context)).toHaveProperty('cycleId');
    expect(validateTask(draft(), { cycles: [cycle({ status: 'settled' })] })['cycleId']).toContain(
      'finished',
    );
    expect(validateTask(draft(), { cycles: [cycle({ status: 'aborted' })] })['cycleId']).toContain(
      'finished',
    );
  });

  it('needs a description and a due date inside the cycle', () => {
    expect(validateTask(draft({ name: 'x' }), context)).toHaveProperty('name');
    expect(validateTask(draft({ dueOn: '' }), context)).toHaveProperty('dueOn');
    expect(validateTask(draft({ dueOn: '2025-06-01' }), context)).toHaveProperty('dueOn');
  });
});
