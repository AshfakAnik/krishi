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
import { HttpApiService } from '../../core/http/http-api';
import { formatMaund } from '../../core/models/common';
import {
  CROP_STAGE_LABELS,
  CropStage,
  DAMAGE_CAUSE_LABELS,
  DamageCause,
  MonitoringLog,
  OBSERVATION_KIND_LABELS,
  ObservationKind,
} from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  cultivationCyclesFeature,
  landsFeature,
  monitoringLogsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  ObservationDraft,
  adjusts,
  nextObservationReference,
  observationFromDraft,
  validateObservation,
  yieldAfterDamage,
} from './monitoring-rules';

/**
 * Records an observation, and — when it reports damage — moves the cycle's
 * expected yield.
 *
 * That yield is what every harvest and settlement figure downstream derives
 * from, so the form shows the new figure before anything is committed.
 */
@Component({
  selector: 'app-observation-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './observation-form.html',
  styleUrl: './observation-form.css',
})
export class ObservationForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);
  private readonly httpApi = inject(HttpApiService);

  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly logs = this.store.selectSignal(monitoringLogsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(monitoringLogsFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly kinds = Object.keys(OBSERVATION_KIND_LABELS) as ObservationKind[];
  protected readonly kindLabels = OBSERVATION_KIND_LABELS;
  protected readonly stages = Object.keys(CROP_STAGE_LABELS) as CropStage[];
  protected readonly stageLabels = CROP_STAGE_LABELS;
  protected readonly causes = Object.keys(DAMAGE_CAUSE_LABELS) as DamageCause[];
  protected readonly causeLabels = DAMAGE_CAUSE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    cycleId: '',
    kind: 'field-visit' as ObservationKind,
    stage: 'vegetative' as CropStage,
    cause: 'none' as DamageCause,
    damagePercent: 0,
    observedOn: this.clock.today(),
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<ObservationDraft>(() => {
    const raw = this.value();
    return {
      cycleId: raw.cycleId ?? '',
      kind: (raw.kind ?? 'field-visit') as ObservationKind,
      stage: (raw.stage ?? 'vegetative') as CropStage,
      cause: (raw.cause ?? 'none') as DamageCause,
      damagePercent: Number(raw.damagePercent ?? 0),
      observedOn: raw.observedOn ?? '',
      note: raw.note ?? '',
    };
  });

  protected readonly availableCycles = computed(() =>
    this.cycles().filter((row) => row.status !== 'settled' && row.status !== 'aborted'),
  );

  protected readonly selectedCycle = computed(() =>
    this.cycles().find((row) => row.id === this.draft().cycleId),
  );

  protected readonly willAdjust = computed(() => adjusts(this.draft()));

  /** The consequence, shown before it is committed. */
  protected readonly yieldPreview = computed(() => {
    const cycle = this.selectedCycle();
    if (!cycle) {
      return '';
    }
    if (!this.willAdjust()) {
      return `${cycle.reference} stays at ${formatMaund(cycle.expectedYield)} — this observation records no loss.`;
    }
    const after = yieldAfterDamage(cycle.expectedYield, this.draft().damagePercent);
    return `Expected harvest falls from ${formatMaund(cycle.expectedYield)} to ${formatMaund(after)}.`;
  });

  private readonly errors = computed(() =>
    validateObservation(this.draft(), { cycles: this.cycles() }),
  );

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
    return `${cycle.reference} · ${land?.name ?? '—'} · ${formatMaund(cycle.expectedYield)}`;
  }

  /**
   * `MonitoringLogService.create()` applies the observation to its cycle's
   * `expectedYield` server-side, in the same transaction — there is no PUT
   * on `cultivationCycles` (only `advance`/`abort` action endpoints), so
   * the mock's client-side `applyObservation` upsert would 404/405 against
   * the real backend. Posted directly (not via the generic store dispatch)
   * so the cycle reload can be sequenced after the create actually lands.
   */
  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const cycle = this.selectedCycle();
    if (!cycle) {
      return;
    }

    const draft = this.draft();
    const preview = observationFromDraft(
      draft,
      cycle,
      {
        id: `mon-${this.clock.now().getTime()}`,
        reference: nextObservationReference(this.logs(), this.clock.year()),
      },
      this.session.actorName(),
    );

    this.httpApi
      .create<MonitoringLog>('monitoringLogs', preview)
      .subscribe({
        next: (log) => {
          this.store.dispatch(monitoringLogsFeature.actions.upsertSuccess({ item: log }));
          if (log.yieldAfter !== log.yieldBefore) {
            this.store.dispatch(cultivationCyclesFeature.actions.load());
          }
          this.audit.record({
            actorRole: this.session.role() ?? 'unknown',
            actorName: this.session.actorName(),
            action: this.willAdjust() ? 'Recorded crop damage' : 'Recorded crop observation',
            moduleName: 'Crop Monitoring',
            details:
              log.yieldAfter !== log.yieldBefore
                ? `${log.reference} · ${cycle.reference} · ${DAMAGE_CAUSE_LABELS[log.cause]} · yield ${log.yieldBefore} → ${log.yieldAfter} maund`
                : `${log.reference} · ${cycle.reference} · no loss`,
          });
          this.closed.emit();
        },
        error: (err: unknown) =>
          this.store.dispatch(
            monitoringLogsFeature.actions.upsertFailure({
              error: err instanceof Error ? err.message : 'Request failed.',
            }),
          ),
      });
  }
}
