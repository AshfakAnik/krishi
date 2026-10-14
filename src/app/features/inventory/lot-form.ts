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
import {
  GRADE_LABELS,
  LOT_HOLDER_LABELS,
  LotHolder,
  QualityGrade,
} from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import { cultivationCyclesFeature, stockLotsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { LotDraft, lotFromDraft, nextLotReference, validateLot } from './stock-rules';

/** Records a lot directly, for produce that reached store without a processing
 *  step — a crop sold straight off the field, most often. */
@Component({
  selector: 'app-lot-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './lot-form.html',
  styleUrl: './lot-form.css',
})
export class LotForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  protected readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lots = this.store.selectSignal(stockLotsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(stockLotsFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly grades = Object.keys(GRADE_LABELS) as QualityGrade[];
  protected readonly gradeLabels = GRADE_LABELS;
  protected readonly holders = Object.keys(LOT_HOLDER_LABELS) as LotHolder[];
  protected readonly holderLabels = LOT_HOLDER_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    cycleId: '',
    grade: 'a' as QualityGrade,
    heldFor: 'pool' as LotHolder,
    quantity: 0,
    location: '',
    storedOn: this.clock.today(),
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<LotDraft>(() => {
    const raw = this.value();
    return {
      cycleId: raw.cycleId ?? '',
      grade: (raw.grade ?? 'a') as QualityGrade,
      heldFor: (raw.heldFor ?? 'pool') as LotHolder,
      quantity: Number(raw.quantity ?? 0),
      location: raw.location ?? '',
      storedOn: raw.storedOn ?? '',
      note: raw.note ?? '',
    };
  });

  private readonly errors = computed(() => validateLot(this.draft()));

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const lot = lotFromDraft(
      this.draft(),
      `lot-${this.clock.now().getTime()}`,
      nextLotReference(this.lots(), this.clock.year()),
    );

    this.store.dispatch(stockLotsFeature.actions.upsertMany({ items: [lot] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Recorded stock lot',
      moduleName: 'Storage & Inventory',
      details: `${lot.reference} · ${formatMaund(lot.quantity)} · ${LOT_HOLDER_LABELS[lot.heldFor]} · ${lot.location}`,
    });

    this.closed.emit();
  }
}
