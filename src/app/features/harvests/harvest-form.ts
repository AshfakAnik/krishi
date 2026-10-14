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
import { formatMaund, formatTaka } from '../../core/models/common';
import { GRADE_LABELS, QualityGrade } from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import { cultivationCyclesFeature, harvestsFeature, landsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  HarvestDraft,
  harvestFromDraft,
  harvestedSoFar,
  nextBatchNo,
  nextHarvestReference,
  validateHarvest,
} from './harvest-rules';

/** Records one batch off a cycle. Lane 4 expects several per cycle, so the form
 *  shows the running total against the expectation. */
@Component({
  selector: 'app-harvest-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './harvest-form.html',
  styleUrl: './harvest-form.css',
})
export class HarvestForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly harvests = this.store.selectSignal(harvestsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(harvestsFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly grades = Object.keys(GRADE_LABELS) as QualityGrade[];
  protected readonly gradeLabels = GRADE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    cycleId: '',
    harvestedOn: this.clock.today(),
    quantity: 0,
    grade: 'a' as QualityGrade,
    labourCost: 0,
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<HarvestDraft>(() => {
    const raw = this.value();
    return {
      cycleId: raw.cycleId ?? '',
      harvestedOn: raw.harvestedOn ?? '',
      quantity: Number(raw.quantity ?? 0),
      grade: (raw.grade ?? 'a') as QualityGrade,
      labourCost: Number(raw.labourCost ?? 0),
      note: raw.note ?? '',
    };
  });

  /** Cycles that could actually have produced something. */
  protected readonly availableCycles = computed(() =>
    this.cycles().filter((row) => row.status === 'ongoing' || row.status === 'harvesting'),
  );

  protected readonly selectedCycle = computed(() =>
    this.cycles().find((row) => row.id === this.draft().cycleId),
  );

  /** The running total, so a second batch is entered against what came before. */
  protected readonly progress = computed(() => {
    const cycle = this.selectedCycle();
    if (!cycle) {
      return '';
    }
    const already = harvestedSoFar(cycle.id, this.harvests());
    const total = already + this.draft().quantity;
    return `${formatMaund(already)} already cut; this batch takes ${cycle.reference} to ${formatMaund(total)} against an expected ${formatMaund(cycle.expectedYield)}.`;
  });

  private readonly errors = computed(() =>
    validateHarvest(this.draft(), { cycles: this.cycles(), harvests: this.harvests() }),
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
    return `${cycle.reference} · ${land?.name ?? '—'} · batch ${nextBatchNo(cycle.id, this.harvests())}`;
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

    const harvest = harvestFromDraft(
      this.draft(),
      {
        id: `hrv-${this.clock.now().getTime()}`,
        reference: nextHarvestReference(this.harvests(), this.clock.year()),
      },
      nextBatchNo(cycle.id, this.harvests()),
    );

    this.store.dispatch(harvestsFeature.actions.upsertMany({ items: [harvest] }));

    // A cycle that starts producing is harvesting, whatever it said before.
    if (cycle.status === 'ongoing') {
      this.store.dispatch(
        cultivationCyclesFeature.actions.upsert({ item: { ...cycle, status: 'harvesting' } }),
      );
    }

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Recorded harvest batch',
      moduleName: 'Harvests',
      details: `${harvest.reference} · ${cycle.reference} · batch ${harvest.batchNo} · ${formatMaund(harvest.quantity)} · labour ${formatTaka(harvest.labourCost)}`,
    });

    this.closed.emit();
  }
}
