import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { CROP_STAGE_LABELS, CropStage } from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  calendarTasksFeature,
  cultivationCyclesFeature,
  landsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { TaskDraft, taskFromDraft, validateTask } from './calendar-rules';

/** Adds one task by hand, for the thing the template did not anticipate. */
@Component({
  selector: 'app-task-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './task-form.html',
  styleUrl: './task-form.css',
})
export class TaskForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(calendarTasksFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly stages = Object.keys(CROP_STAGE_LABELS) as CropStage[];
  protected readonly stageLabels = CROP_STAGE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    cycleId: '',
    stage: 'vegetative' as CropStage,
    name: '',
    dueOn: this.clock.today(),
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<TaskDraft>(() => {
    const raw = this.value();
    return {
      cycleId: raw.cycleId ?? '',
      stage: (raw.stage ?? 'vegetative') as CropStage,
      name: raw.name ?? '',
      dueOn: raw.dueOn ?? '',
    };
  });

  /** Only live cycles: nothing more is due on one that has finished. */
  protected readonly availableCycles = computed(() =>
    this.cycles().filter((row) => row.status !== 'settled' && row.status !== 'aborted'),
  );

  private readonly errors = computed(() => validateTask(this.draft(), { cycles: this.cycles() }));

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected cycleLabel(id: string): string {
    const cycle = this.cycles().find((row) => row.id === id);
    if (!cycle) {
      return '—';
    }
    const land = this.lands().find((row) => row.id === cycle.landId);
    return `${cycle.reference} · ${land?.name ?? '—'}`;
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const task = taskFromDraft(this.draft(), `task-${this.clock.now().getTime()}`);
    this.store.dispatch(calendarTasksFeature.actions.upsertMany({ items: [task] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Added calendar task',
      moduleName: 'Farming Calendar',
      details: `${this.cycleLabel(task.cycleId)} · ${task.name} · due ${task.dueOn}`,
    });

    this.closed.emit();
  }
}
