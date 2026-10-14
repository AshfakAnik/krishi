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
import { LEDGER_KIND_LABELS, LedgerKind } from '../../core/models/settlement';
import { SessionService } from '../../core/session';
import {
  financeEntriesFeature,
  partiesFeature,
  settlementsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  FinanceDraft,
  entryFromDraft,
  isInKind,
  nextFinanceReference,
  validateEntry,
} from './finance-rules';

/** Adds a ledger line by hand, for what a settlement did not raise. */
@Component({
  selector: 'app-finance-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './finance-form.html',
  styleUrl: './finance-form.css',
})
export class FinanceForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  protected readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  protected readonly settlements = this.store.selectSignal(settlementsFeature.selectors.all);
  private readonly entries = this.store.selectSignal(financeEntriesFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(financeEntriesFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly kinds = Object.keys(LEDGER_KIND_LABELS) as LedgerKind[];
  protected readonly kindLabels = LEDGER_KIND_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    kind: 'payable' as LedgerKind,
    partyId: '',
    settlementId: '',
    amount: 0,
    quantity: 0,
    raisedOn: this.clock.today(),
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<FinanceDraft>(() => {
    const raw = this.value();
    return {
      kind: (raw.kind ?? 'payable') as LedgerKind,
      partyId: raw.partyId ?? '',
      settlementId: raw.settlementId ?? '',
      amount: Number(raw.amount ?? 0),
      quantity: Number(raw.quantity ?? 0),
      raisedOn: raw.raisedOn ?? '',
      note: raw.note ?? '',
    };
  });

  /** A transfer moves maund, so the taka field is not the one to fill in. */
  protected readonly inKind = computed(() => isInKind(this.draft().kind));

  private readonly errors = computed(() =>
    validateEntry(this.draft(), {
      parties: this.parties(),
      settlements: this.settlements(),
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const entry = entryFromDraft(this.draft(), {
      id: `fin-${this.clock.now().getTime()}`,
      reference: nextFinanceReference(this.entries(), this.clock.year()),
    });

    this.store.dispatch(financeEntriesFeature.actions.upsertMany({ items: [entry] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Added ledger entry',
      moduleName: 'Finance',
      details: `${entry.reference} · ${LEDGER_KIND_LABELS[entry.kind]} · ${entry.quantity ? entry.quantity + ' maund' : formatTaka(entry.amount)}`,
    });

    this.closed.emit();
  }
}
