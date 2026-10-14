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
import { formatTaka } from '../../core/models/common';
import { SETTLEMENT_MODE_LABELS, SettlementMode } from '../../core/models/settlement';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  cultivationCyclesFeature,
  farmingActivitiesFeature,
  salesFeature,
  settlementsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  SettlementDraft,
  costsFor,
  divide,
  nextSettlementReference,
  outstandingAdvance,
  ownerShareFraction,
  proceedsFor,
  settlementFromDraft,
  validateSettlement,
} from './settlement-rules';

/**
 * Prepares a settlement.
 *
 * Nothing here is typed except the cycle, the mode and the date — every figure
 * is derived from what the other modules recorded, and shown in full before it
 * is committed. A settlement somebody can hand-edit is a settlement neither
 * party can trust.
 */
@Component({
  selector: 'app-settlement-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './settlement-form.html',
  styleUrl: './settlement-form.css',
})
export class SettlementForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly settlements = this.store.selectSignal(settlementsFeature.selectors.all);
  private readonly sales = this.store.selectSignal(salesFeature.selectors.all);
  private readonly activities = this.store.selectSignal(farmingActivitiesFeature.selectors.all);
  private readonly ledger = this.store.selectSignal(advancesFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(settlementsFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly modes = Object.keys(SETTLEMENT_MODE_LABELS) as SettlementMode[];
  protected readonly modeLabels = SETTLEMENT_MODE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    cycleId: '',
    mode: 'pooled' as SettlementMode,
    settledOn: this.clock.today(),
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<SettlementDraft>(() => {
    const raw = this.value();
    return {
      cycleId: raw.cycleId ?? '',
      mode: (raw.mode ?? 'pooled') as SettlementMode,
      settledOn: raw.settledOn ?? '',
      note: raw.note ?? '',
    };
  });

  /** Cycles that have produced something and have not been settled. */
  protected readonly availableCycles = computed(() => {
    const settled = new Set(
      this.settlements()
        .filter((row) => row.status !== 'draft')
        .map((row) => row.cycleId),
    );
    return this.cycles().filter((row) => row.status !== 'planned' && !settled.has(row.id));
  });

  protected readonly selectedCycle = computed(() =>
    this.cycles().find((row) => row.id === this.draft().cycleId),
  );

  private readonly agreement = computed(
    () => this.agreements().find((row) => row.id === this.selectedCycle()?.agreementId) ?? null,
  );

  /** The whole division, previewed. */
  protected readonly preview = computed(() => {
    const cycle = this.selectedCycle();
    if (!cycle) {
      return null;
    }
    const proceeds = proceedsFor(cycle.id, this.sales());
    const outstanding = outstandingAdvance(cycle.agreementId, this.ledger());
    const split = divide({
      mode: this.draft().mode,
      proceeds,
      ownerFraction: ownerShareFraction(this.agreement()),
      outstanding,
    });
    return { proceeds, outstanding, costs: costsFor(cycle.id, this.activities()), ...split };
  });

  private readonly errors = computed(() =>
    validateSettlement(this.draft(), {
      cycles: this.cycles(),
      agreements: this.agreements(),
      settlements: this.settlements(),
      sales: this.sales(),
      activities: this.activities(),
      ledger: this.ledger(),
    }),
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
    return `${cycle.reference} · ${formatTaka(proceedsFor(cycle.id, this.sales()))} sold`;
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const cycle = this.selectedCycle();
    if (!cycle) {
      return;
    }

    const prepared = settlementFromDraft(
      this.draft(),
      cycle,
      this.agreement(),
      { sales: this.sales(), activities: this.activities(), ledger: this.ledger() },
      {
        id: `stl-${this.clock.now().getTime()}`,
        reference: nextSettlementReference(this.settlements(), this.clock.year()),
      },
      this.session.actorName(),
    );

    this.store.dispatch(settlementsFeature.actions.upsertMany({ items: [prepared] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Prepared settlement',
      moduleName: 'Settlements',
      details: `${prepared.reference} · ${cycle.reference} · proceeds ${formatTaka(prepared.grossProceeds)} · owner ${formatTaka(prepared.ownerProceeds)} · sharecropper ${formatTaka(prepared.netToSharecropper)} after ${formatTaka(prepared.advanceDeducted)} dadhon`,
    });

    this.closed.emit();
  }
}
