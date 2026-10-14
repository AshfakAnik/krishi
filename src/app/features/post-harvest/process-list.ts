import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { HttpApiService } from '../../core/http/http-api';
import { Tone, formatDate, formatMaund } from '../../core/models/common';
import { BATCH_STATUS_LABELS, PROCESS_LABELS, ProcessingBatch } from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import {
  harvestsFeature,
  processingBatchesFeature,
  stockLotsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { ProcessForm } from './process-form';
import { completionError, wastage, wastagePercent } from './process-rules';

/**
 * Processing batches, with the closing figure entered inline.
 *
 * Completing a batch is the module's decision, and it does two things: it fixes
 * the wastage, and it produces the stock lot the sales module draws from.
 */
@Component({
  selector: 'app-process-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, EmptyState, Icon, KpiTile, PageHeader, SectionCard, StatusBadge, ProcessForm],
  templateUrl: './process-list.html',
  styleUrl: './process-list.css',
})
export class ProcessList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly clock = inject(SessionClock);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  protected readonly batches = this.store.selectSignal(processingBatchesFeature.selectors.all);
  private readonly harvests = this.store.selectSignal(harvestsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(processingBatchesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(processingBatchesFeature.selectors.error);
  protected readonly saving = this.store.selectSignal(processingBatchesFeature.selectors.saving);

  protected readonly formOpen = signal(false);
  protected readonly processLabels = PROCESS_LABELS;
  protected readonly statusLabels = BATCH_STATUS_LABELS;

  /** Output figures being typed, keyed by batch id. */
  private readonly outputs = signal<Record<string, number>>({});
  protected readonly closeError = signal('');

  constructor() {
    for (const feature of [processingBatchesFeature, harvestsFeature, stockLotsFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly running = computed(() =>
    this.batches().filter((row) => row.status === 'running'),
  );

  protected readonly completed = computed(() =>
    this.batches().filter((row) => row.status === 'complete'),
  );

  protected readonly totalWastage = computed(() =>
    this.completed().reduce((total, row) => total + wastage(row), 0),
  );

  protected outputFor(batch: ProcessingBatch): number {
    return this.outputs()[batch.id] ?? 0;
  }

  protected onOutput(batch: ProcessingBatch, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.outputs.update((current) => ({ ...current, [batch.id]: value }));
  }

  protected harvestRef(batch: ProcessingBatch): string {
    return this.harvests().find((row) => row.id === batch.harvestId)?.reference ?? '—';
  }

  protected lost(batch: ProcessingBatch): string {
    return `${formatMaund(wastage(batch))} · ${wastagePercent(batch)}%`;
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected wastageTone(batch: ProcessingBatch): Tone {
    const percent = wastagePercent(batch);
    if (percent > 25) {
      return 'bad';
    }
    return percent > 12 ? 'warn' : 'ok';
  }

  /**
   * Closes a batch and files the result into store.
   *
   * The stock lot is the whole point of the step: without it, produce that has
   * been dried and threshed exists nowhere the sales module can find it.
   */
  protected closeBatch(batch: ProcessingBatch): void {
    const output = this.outputFor(batch);
    const today = this.clock.today();
    const problem = completionError(batch, output, today);
    if (problem) {
      this.closeError.set(`${batch.reference}: ${problem}`);
      return;
    }
    this.closeError.set('');

    // `ProcessingBatchService.complete()` files the resulting stock lot
    // server-side, in the same transaction — it isn't in the response, so
    // reload `stockLots` to pick it up rather than computing it here.
    this.httpApi
      .action<ProcessingBatch>('processingBatches', batch.id, 'complete', {
        output,
        completedOn: today,
        location: 'Unassigned store',
      })
      .subscribe({
        next: (closed) => {
          this.store.dispatch(processingBatchesFeature.actions.upsertSuccess({ item: closed }));
          this.store.dispatch(stockLotsFeature.actions.load());
          this.audit.record({
            actorRole: this.session.role() ?? 'unknown',
            actorName: this.session.actorName(),
            action: 'Completed processing batch',
            moduleName: 'Post-Harvest',
            details: `${closed.reference} · ${formatMaund(closed.inputQuantity)} in, ${formatMaund(output)} out · wastage ${wastagePercent(closed)}%`,
          });
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  /** The inverse, for a batch closed with the wrong figure. `reopen()` also
   *  deletes the lot it filed (server-side, refused if sales already exist
   *  against it) — reload `stockLots` to reflect that. */
  protected reopenBatch(batch: ProcessingBatch): void {
    this.httpApi.action<ProcessingBatch>('processingBatches', batch.id, 'reopen').subscribe({
      next: (reopened) => {
        this.store.dispatch(processingBatchesFeature.actions.upsertSuccess({ item: reopened }));
        this.store.dispatch(stockLotsFeature.actions.load());
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Reopened processing batch',
          moduleName: 'Post-Harvest',
          details: `${batch.reference} · output cleared`,
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      processingBatchesFeature.actions.upsertFailure({
        error: err instanceof Error ? err.message : 'Request failed.',
      }),
    );
  }

  protected clearError(): void {
    this.store.dispatch(processingBatchesFeature.actions.clearError());
  }
}
