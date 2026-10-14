import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { HttpApiService } from '../../core/http/http-api';
import { Tone, formatDate } from '../../core/models/common';
import {
  CROP_STAGE_LABELS,
  CalendarTask,
  CultivationCycle,
  TASK_STATUS_LABELS,
} from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  calendarTasksFeature,
  cropVarietiesFeature,
  cultivationCyclesFeature,
  landsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import {
  TaskStanding,
  generateCalendar,
  isOpen,
  overdueCount,
  taskStanding,
} from './calendar-rules';
import { TaskForm } from './task-form';

/**
 * The calendar, grouped by cycle rather than listed flat.
 *
 * A departure from the recipe, and a deliberate one: a task has nothing to show
 * on a page of its own, so there is no detail route. The board *is* the detail,
 * and the actions live inline on each row.
 */
@Component({
  selector: 'app-calendar-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, EmptyState, Icon, KpiTile, PageHeader, SectionCard, StatusBadge, TaskForm],
  templateUrl: './calendar-board.html',
  styleUrl: './calendar-board.css',
})
export class CalendarBoard {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly clock = inject(SessionClock);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  private readonly tasks = this.store.selectSignal(calendarTasksFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(calendarTasksFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(calendarTasksFeature.selectors.error);
  protected readonly saving = this.store.selectSignal(calendarTasksFeature.selectors.saving);

  protected readonly formOpen = signal(false);
  protected readonly showClosed = signal(false);
  protected readonly stageLabels = CROP_STAGE_LABELS;
  protected readonly statusLabels = TASK_STATUS_LABELS;

  constructor() {
    for (const feature of [
      calendarTasksFeature,
      cultivationCyclesFeature,
      landsFeature,
      cropVarietiesFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly today = computed(() => this.clock.today());

  /** Cycles the actor can see, live ones only — a finished cycle's calendar is
   *  history, and showing it would bury what is actually due. */
  protected readonly liveCycles = computed(() => {
    const actor = this.session.actor();
    const live = this.cycles().filter(
      (row) => row.status !== 'settled' && row.status !== 'aborted',
    );
    if (!actor || actor.role === 'admin') {
      return live;
    }
    if (actor.role === 'sharecropper') {
      return live.filter((row) => row.sharecropperId === actor.id);
    }
    const mine = new Set(
      this.lands()
        .filter((land) => land.ownerId === actor.id)
        .map((land) => land.id),
    );
    return live.filter((row) => mine.has(row.landId));
  });

  private readonly visibleTasks = computed(() => {
    const ids = new Set(this.liveCycles().map((row) => row.id));
    return this.tasks().filter((task) => ids.has(task.cycleId));
  });

  protected readonly openCount = computed(() => this.visibleTasks().filter(isOpen).length);

  protected readonly overdue = computed(() => overdueCount(this.visibleTasks(), this.today()));

  protected readonly dueSoon = computed(
    () =>
      this.visibleTasks().filter((task) => taskStanding(task, this.today()) === 'due-soon').length,
  );

  /** One group per cycle, each carrying its own tasks in due order. */
  protected readonly groups = computed(() =>
    this.liveCycles().map((cycle) => ({
      cycle,
      tasks: this.tasksFor(cycle),
    })),
  );

  protected tasksFor(cycle: CultivationCycle): CalendarTask[] {
    return this.visibleTasks()
      .filter((task) => task.cycleId === cycle.id)
      .filter((task) => this.showClosed() || isOpen(task))
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  }

  protected landName(cycle: CultivationCycle): string {
    return this.lands().find((row) => row.id === cycle.landId)?.name ?? '—';
  }

  protected standing(task: CalendarTask): TaskStanding {
    return taskStanding(task, this.today());
  }

  protected standingLabel(task: CalendarTask): string {
    switch (this.standing(task)) {
      case 'overdue':
        return 'Overdue';
      case 'due-soon':
        return 'Due soon';
      case 'closed':
        return TASK_STATUS_LABELS[task.status];
      default:
        return 'Upcoming';
    }
  }

  protected standingTone(task: CalendarTask): Tone {
    switch (this.standing(task)) {
      case 'overdue':
        return 'bad';
      case 'due-soon':
        return 'warn';
      case 'closed':
        return task.status === 'done' ? 'ok' : 'neutral';
      default:
        return 'neutral';
    }
  }

  protected due(task: CalendarTask): string {
    return formatDate(task.dueOn);
  }

  protected openTask(task: CalendarTask): boolean {
    return isOpen(task);
  }

  protected markDone(task: CalendarTask): void {
    this.httpApi
      .action<CalendarTask>('calendarTasks', task.id, 'complete', { on: this.today(), note: '' })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(calendarTasksFeature.actions.upsertSuccess({ item: updated }));
          this.log('Completed calendar task', updated);
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  protected markSkipped(task: CalendarTask): void {
    this.httpApi
      .action<CalendarTask>('calendarTasks', task.id, 'skip', { on: this.today(), note: '' })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(calendarTasksFeature.actions.upsertSuccess({ item: updated }));
          this.log('Skipped calendar task', updated);
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  /** The inverse of both, for a task closed by mistake. */
  protected reopenTask(task: CalendarTask): void {
    this.httpApi.action<CalendarTask>('calendarTasks', task.id, 'reopen').subscribe({
      next: (updated) => {
        this.store.dispatch(calendarTasksFeature.actions.upsertSuccess({ item: updated }));
        this.log('Reopened calendar task', updated);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      calendarTasksFeature.actions.upsertFailure({
        error: err instanceof Error ? err.message : 'Request failed.',
      }),
    );
  }

  /**
   * Lays a whole season out for a cycle that has none. This is the module's
   * reason to exist: a calendar somebody has to fill in by hand is a calendar
   * nobody fills in.
   */
  protected generateFor(cycle: CultivationCycle): void {
    if (this.tasksFor(cycle).length || this.hasAnyTask(cycle)) {
      return;
    }
    const variety = this.varieties().find((row) => row.id === cycle.varietyId);
    const stamp = this.clock.now().getTime();
    const tasks = generateCalendar(cycle, variety, (index) => `task-${stamp}-${index}`);

    this.store.dispatch(calendarTasksFeature.actions.upsertMany({ items: tasks }));
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Generated farming calendar',
      moduleName: 'Farming Calendar',
      details: `${cycle.reference} · ${this.landName(cycle)} · ${tasks.length} tasks`,
    });
  }

  protected hasAnyTask(cycle: CultivationCycle): boolean {
    return this.tasks().some((task) => task.cycleId === cycle.id);
  }

  protected clearError(): void {
    this.store.dispatch(calendarTasksFeature.actions.clearError());
  }

  private log(action: string, task: CalendarTask): void {
    const cycle = this.cycles().find((row) => row.id === task.cycleId);
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Farming Calendar',
      details: `${cycle?.reference ?? '—'} · ${task.name} · due ${task.dueOn}`,
    });
  }
}
