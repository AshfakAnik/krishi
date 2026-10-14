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
import { DISPUTE_POINT_LABELS, Dispute, DisputePoint } from '../../core/models/settlement';
import { SessionService } from '../../core/session';
import { disputesFeature, settlementsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  DisputeDraft,
  disputeFromDraft,
  nextDisputeReference,
  validateDispute,
} from './dispute-rules';

/** Raises an objection against a settlement, naming where the work goes back to. */
@Component({
  selector: 'app-dispute-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './dispute-form.html',
  styleUrl: './dispute-form.css',
})
export class DisputeForm {
  readonly closed = output<void>();
  /** Emits the settlement id, so the list can mark it disputed. */
  readonly raised = output<string>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);
  private readonly httpApi = inject(HttpApiService);

  private readonly settlements = this.store.selectSignal(settlementsFeature.selectors.all);
  private readonly disputes = this.store.selectSignal(disputesFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(disputesFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly points = Object.keys(DISPUTE_POINT_LABELS) as DisputePoint[];
  protected readonly pointLabels = DISPUTE_POINT_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    settlementId: '',
    reroute: 'costs' as DisputePoint,
    reason: '',
    raisedOn: this.clock.today(),
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<DisputeDraft>(() => {
    const raw = this.value();
    return {
      settlementId: raw.settlementId ?? '',
      reroute: (raw.reroute ?? 'costs') as DisputePoint,
      reason: raw.reason ?? '',
      raisedOn: raw.raisedOn ?? '',
    };
  });

  /** Settlements still open to objection — a closed one is final. */
  protected readonly availableSettlements = computed(() =>
    this.settlements().filter((row) => row.status !== 'closed'),
  );

  private readonly errors = computed(() =>
    validateDispute(this.draft(), {
      settlements: this.settlements(),
      disputes: this.disputes(),
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  /**
   * `DisputeService.create()` also marks the target settlement `disputed`,
   * server-side, in the same transaction — posted directly (rather than via
   * the generic store dispatch) so `raised.emit()` only fires once that has
   * actually happened, not the instant the optimistic write is queued.
   */
  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const draft = this.draft();
    const preview = disputeFromDraft(
      draft,
      {
        id: `dis-${this.clock.now().getTime()}`,
        reference: nextDisputeReference(this.disputes(), this.clock.year()),
      },
      this.session.actorName(),
    );

    this.httpApi.create<Dispute>('disputes', preview).subscribe({
      next: (dispute) => {
        this.store.dispatch(disputesFeature.actions.upsertSuccess({ item: dispute }));
        this.raised.emit(dispute.settlementId);
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Raised dispute',
          moduleName: 'Disputes',
          details: `${dispute.reference} · ${DISPUTE_POINT_LABELS[dispute.reroute]} · ${dispute.reason}`,
        });
        this.closed.emit();
      },
      error: (err: unknown) =>
        this.store.dispatch(
          disputesFeature.actions.upsertFailure({
            error: err instanceof Error ? err.message : 'Request failed.',
          }),
        ),
    });
  }
}
