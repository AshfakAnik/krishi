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
import { RESPONSIBLE_LABELS } from '../../core/models/agreement';
import { MODEL_LABELS } from '../../core/models/agriculture';
import { formatTaka } from '../../core/models/common';
import {
  ACTIVITY_KIND_LABELS,
  ActivityKind,
  COST_LINE_LABELS,
  CostLine,
} from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cultivationCyclesFeature,
  farmingActivitiesFeature,
  landsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  ActivityDraft,
  activityFromDraft,
  costResponsibilityFor,
  nextActivityReference,
  splitCost,
  validateActivity,
} from './activity-rules';

/**
 * Records what was done and what it cost.
 *
 * The form never asks who pays. It reads the answer out of the agreement and
 * shows it — the split is a consequence of terms already negotiated, not a
 * choice made by whoever happens to be entering the expense.
 */
@Component({
  selector: 'app-activity-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './activity-form.html',
  styleUrl: './activity-form.css',
})
export class ActivityForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly activities = this.store.selectSignal(farmingActivitiesFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(farmingActivitiesFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly kinds = Object.keys(ACTIVITY_KIND_LABELS) as ActivityKind[];
  protected readonly kindLabels = ACTIVITY_KIND_LABELS;
  protected readonly costLines = Object.keys(COST_LINE_LABELS) as CostLine[];
  protected readonly costLineLabels = COST_LINE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    cycleId: '',
    kind: 'fertiliser' as ActivityKind,
    costLine: 'input' as CostLine,
    performedOn: this.clock.today(),
    amount: 0,
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<ActivityDraft>(() => {
    const raw = this.value();
    return {
      cycleId: raw.cycleId ?? '',
      kind: (raw.kind ?? 'fertiliser') as ActivityKind,
      costLine: (raw.costLine ?? 'input') as CostLine,
      performedOn: raw.performedOn ?? '',
      amount: Number(raw.amount ?? 0),
      note: raw.note ?? '',
    };
  });

  /** Cycles still able to take an expense: not settled, not aborted. */
  protected readonly availableCycles = computed(() => {
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

  protected readonly selectedCycle = computed(() =>
    this.cycles().find((row) => row.id === this.draft().cycleId),
  );

  private readonly governingAgreement = computed(
    () => this.agreements().find((row) => row.id === this.selectedCycle()?.agreementId) ?? null,
  );

  /** The answer to "who pays", read rather than asked. */
  protected readonly bearer = computed(() =>
    costResponsibilityFor(this.draft().costLine, this.governingAgreement()),
  );

  protected readonly bearerLabel = computed(() => RESPONSIBLE_LABELS[this.bearer()]);

  protected readonly split = computed(() => splitCost(this.draft().amount, this.bearer()));

  /** Why the split is what it is — the terms behind it, named. */
  protected readonly basis = computed(() => {
    const cycle = this.selectedCycle();
    if (!cycle) {
      return 'Pick a cycle to see who carries the cost.';
    }
    const agreement = this.governingAgreement();
    if (!agreement) {
      return 'Owner-farmed cycle — there is nobody else to bear the cost.';
    }
    if (agreement.terms.model === 'tevaga') {
      return `${agreement.reference} is ${MODEL_LABELS.tevaga}: the sharecropper bears the entire cultivation cost.`;
    }
    return `From ${agreement.reference}, where ${this.costLineLabels[this.draft().costLine].toLowerCase()} is set to “${this.bearerLabel().toLowerCase()}”.`;
  });

  private readonly errors = computed(() =>
    validateActivity(this.draft(), {
      cycles: this.cycles(),
      agreements: this.agreements(),
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
    const land = this.lands().find((row) => row.id === cycle.landId);
    return `${cycle.reference} · ${land?.name ?? '—'}`;
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const activity = activityFromDraft(this.draft(), this.governingAgreement(), {
      id: `act-${this.clock.now().getTime()}`,
      reference: nextActivityReference(this.activities(), this.clock.year()),
    });

    this.store.dispatch(farmingActivitiesFeature.actions.upsertMany({ items: [activity] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Recorded farming activity',
      moduleName: 'Farming Activities',
      details: `${activity.reference} · ${this.cycleLabel(activity.cycleId)} · ${formatTaka(activity.amount)} · ${RESPONSIBLE_LABELS[activity.bearer]}`,
    });

    this.closed.emit();
  }
}
