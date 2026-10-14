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
import { GRADE_SHORT, LOT_HOLDER_LABELS } from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import { salesFeature, stockLotsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { remaining } from '../inventory/stock-rules';
import {
  SaleDraft,
  nextSaleReference,
  saleFromDraft,
  saleTotals,
  suggestedHaque,
  validateSale,
} from './sale-rules';

/**
 * Records a sale off a stock lot.
 *
 * Gross, deductions and net are shown live, because the net is the figure the
 * settlement divides and a mistyped haque is invisible until then.
 */
@Component({
  selector: 'app-sale-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './sale-form.html',
  styleUrl: './sale-form.css',
})
export class SaleForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly lots = this.store.selectSignal(stockLotsFeature.selectors.all);
  private readonly sales = this.store.selectSignal(salesFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(salesFeature.selectors.saving);

  protected readonly attempted = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    lotId: '',
    soldOn: this.clock.today(),
    quantity: 0,
    unitPrice: 0,
    marketHaque: 0,
    transportCost: 0,
    buyer: '',
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<SaleDraft>(() => {
    const raw = this.value();
    return {
      lotId: raw.lotId ?? '',
      soldOn: raw.soldOn ?? '',
      quantity: Number(raw.quantity ?? 0),
      unitPrice: Number(raw.unitPrice ?? 0),
      marketHaque: Number(raw.marketHaque ?? 0),
      transportCost: Number(raw.transportCost ?? 0),
      buyer: raw.buyer ?? '',
      note: raw.note ?? '',
    };
  });

  /** Lots with something left to sell. */
  protected readonly availableLots = computed(() =>
    this.lots().filter((lot) => remaining(lot, this.sales()) > 0),
  );

  private readonly selectedLot = computed(() =>
    this.lots().find((row) => row.id === this.draft().lotId),
  );

  protected readonly totals = computed(() => saleTotals(this.draft()));

  /** The local two percent, offered so nobody has to work it out. */
  protected readonly haqueHint = computed(() => {
    const gross = this.totals().gross;
    return gross
      ? `Two percent of ${formatTaka(gross)} is ${formatTaka(suggestedHaque(gross))}.`
      : 'The haat’s cut, taken off the gross.';
  });

  private readonly errors = computed(() =>
    validateSale(this.draft(), { lots: this.lots(), sales: this.sales() }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected lotLabel(id: string): string {
    const lot = this.lots().find((row) => row.id === id);
    if (!lot) {
      return '—';
    }
    return `${lot.reference} · Grade ${GRADE_SHORT[lot.grade]} · ${LOT_HOLDER_LABELS[lot.heldFor]} · ${formatMaund(remaining(lot, this.sales()))} left`;
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const lot = this.selectedLot();
    if (!lot) {
      return;
    }

    const sale = saleFromDraft(this.draft(), lot, {
      id: `sal-${this.clock.now().getTime()}`,
      reference: nextSaleReference(this.sales(), this.clock.year()),
    });

    this.store.dispatch(salesFeature.actions.upsertMany({ items: [sale] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Recorded sale',
      moduleName: 'Sales',
      details: `${sale.reference} · ${lot.reference} · ${formatMaund(sale.quantity)} at ${formatTaka(sale.unitPrice)} · net ${formatTaka(sale.netAmount)} · ${sale.buyer}`,
    });

    this.closed.emit();
  }
}
