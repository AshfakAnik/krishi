import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { formatDate, formatMaund, formatTaka } from '../../core/models/common';
import { Sale } from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import {
  cultivationCyclesFeature,
  salesFeature,
  stockLotsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Column, DataTable } from '../../shared/ui/data-table';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { SaleForm } from './sale-form';

/** Every sale, with the deductions that turn a gross into the net Lane 5
 *  divides. */
@Component({
  selector: 'app-sale-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, DataTable, KpiTile, PageHeader, Icon, SaleForm],
  templateUrl: './sale-list.html',
  styleUrl: './sale-list.css',
})
export class SaleList {
  private readonly store = inject(Store);
  protected readonly session = inject(SessionService);

  protected readonly rows = this.store.selectSignal(salesFeature.selectors.all);
  private readonly lots = this.store.selectSignal(stockLotsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(salesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(salesFeature.selectors.error);

  protected readonly formOpen = signal(false);

  constructor() {
    for (const feature of [salesFeature, stockLotsFeature, cultivationCyclesFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly grossTotal = computed(() =>
    this.rows().reduce((total, row) => total + row.grossAmount, 0),
  );

  protected readonly netTotal = computed(() =>
    this.rows().reduce((total, row) => total + row.netAmount, 0),
  );

  protected readonly deductionTotal = computed(() =>
    this.rows().reduce((total, row) => total + row.marketHaque + row.transportCost, 0),
  );

  protected readonly soldQuantity = computed(() =>
    this.rows().reduce((total, row) => total + row.quantity, 0),
  );

  protected readonly columns: Column<Sale>[] = [
    { key: 'reference', label: 'Reference', mono: true, value: (row) => row.reference },
    { key: 'lot', label: 'Lot', value: (row) => this.lotRef(row.lotId) },
    { key: 'cycle', label: 'Cycle', value: (row) => this.cycleRef(row.cycleId) },
    {
      key: 'soldOn',
      label: 'Sold',
      mono: true,
      value: (row) => formatDate(row.soldOn),
      sortValue: (row) => row.soldOn,
    },
    {
      key: 'quantity',
      label: 'Quantity',
      align: 'right',
      mono: true,
      value: (row) => formatMaund(row.quantity),
      sortValue: (row) => row.quantity,
    },
    {
      key: 'unitPrice',
      label: 'Price',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.unitPrice),
      sortValue: (row) => row.unitPrice,
    },
    {
      key: 'grossAmount',
      label: 'Gross',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.grossAmount),
      sortValue: (row) => row.grossAmount,
    },
    {
      key: 'deductions',
      label: 'Haque + transport',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.marketHaque + row.transportCost),
      sortValue: (row) => row.marketHaque + row.transportCost,
    },
    {
      key: 'netAmount',
      label: 'Net',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.netAmount),
      sortValue: (row) => row.netAmount,
    },
    { key: 'buyer', label: 'Buyer', value: (row) => row.buyer },
  ];

  protected lotRef(lotId: string): string {
    return this.lots().find((row) => row.id === lotId)?.reference ?? '—';
  }

  protected cycleRef(cycleId: string): string {
    return this.cycles().find((row) => row.id === cycleId)?.reference ?? '—';
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected clearError(): void {
    this.store.dispatch(salesFeature.actions.clearError());
  }
}
