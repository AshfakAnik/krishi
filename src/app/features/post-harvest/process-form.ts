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
import { formatMaund } from '../../core/models/common';
import { PROCESS_LABELS, ProcessKind } from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import { harvestsFeature, processingBatchesFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  BatchDraft,
  batchFromDraft,
  nextBatchReference,
  unprocessed,
  validateBatch,
} from './process-rules';

/** Opens a processing batch. The input is not asked for — it is whatever the
 *  harvest has left, which is the only figure that can be right. */
@Component({
  selector: 'app-process-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './process-form.html',
  styleUrl: './process-form.css',
})
export class ProcessForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly harvests = this.store.selectSignal(harvestsFeature.selectors.all);
  private readonly batches = this.store.selectSignal(processingBatchesFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(processingBatchesFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly processes = Object.keys(PROCESS_LABELS) as ProcessKind[];
  protected readonly processLabels = PROCESS_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    harvestId: '',
    process: 'drying' as ProcessKind,
    startedOn: this.clock.today(),
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<BatchDraft>(() => {
    const raw = this.value();
    return {
      harvestId: raw.harvestId ?? '',
      process: (raw.process ?? 'drying') as ProcessKind,
      startedOn: raw.startedOn ?? '',
      note: raw.note ?? '',
    };
  });

  /** Harvests with something left to process. */
  protected readonly availableHarvests = computed(() =>
    this.harvests().filter((row) => unprocessed(row, this.batches()) > 0),
  );

  private readonly selectedHarvest = computed(() =>
    this.harvests().find((row) => row.id === this.draft().harvestId),
  );

  protected readonly inputHint = computed(() => {
    const harvest = this.selectedHarvest();
    if (!harvest) {
      return 'The batch takes whatever the harvest has left.';
    }
    return `This batch will take ${formatMaund(unprocessed(harvest, this.batches()))} — everything left of ${harvest.reference}.`;
  });

  private readonly errors = computed(() =>
    validateBatch(this.draft(), { harvests: this.harvests(), batches: this.batches() }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected harvestLabel(id: string): string {
    const harvest = this.harvests().find((row) => row.id === id);
    return harvest
      ? `${harvest.reference} · batch ${harvest.batchNo} · ${formatMaund(unprocessed(harvest, this.batches()))} left`
      : '—';
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const harvest = this.selectedHarvest();
    if (!harvest) {
      return;
    }

    const batch = batchFromDraft(this.draft(), harvest, this.batches(), {
      id: `bat-${this.clock.now().getTime()}`,
      reference: nextBatchReference(this.batches(), this.clock.year()),
    });

    this.store.dispatch(processingBatchesFeature.actions.upsertMany({ items: [batch] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Opened processing batch',
      moduleName: 'Post-Harvest',
      details: `${batch.reference} · ${PROCESS_LABELS[batch.process]} · ${harvest.reference} · ${formatMaund(batch.inputQuantity)} in`,
    });

    this.closed.emit();
  }
}
