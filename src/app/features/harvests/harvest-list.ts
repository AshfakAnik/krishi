import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Tone, formatDate, formatMaund, formatTaka } from '../../core/models/common';
import { GRADE_SHORT, Harvest } from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import { cultivationCyclesFeature, harvestsFeature, landsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Column, DataTable } from '../../shared/ui/data-table';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { HarvestForm } from './harvest-form';
import { harvestedSoFar, yieldAchieved } from './harvest-rules';

/** Every batch off every cycle, with what it achieved against the estimate. */
@Component({
  selector: 'app-harvest-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, DataTable, KpiTile, PageHeader, Icon, HarvestForm],
  templateUrl: './harvest-list.html',
  styleUrl: './harvest-list.css',
})
export class HarvestList {
  private readonly store = inject(Store);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(harvestsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(harvestsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(harvestsFeature.selectors.error);

  protected readonly formOpen = signal(false);

  constructor() {
    for (const feature of [harvestsFeature, cultivationCyclesFeature, landsFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly rows = computed(() => {
    const actor = this.session.actor();
    const all = this.all();
    if (!actor || actor.role === 'admin') {
      return all;
    }
    const visible = new Set(
      this.cycles()
        .filter((cycle) => {
          if (actor.role === 'sharecropper') {
            return cycle.sharecropperId === actor.id;
          }
          const land = this.lands().find((row) => row.id === cycle.landId);
          return land?.ownerId === actor.id;
        })
        .map((cycle) => cycle.id),
    );
    return all.filter((row) => visible.has(row.cycleId));
  });

  protected readonly totalHarvested = computed(() =>
    this.rows().reduce((total, row) => total + row.quantity, 0),
  );

  protected readonly labourTotal = computed(() =>
    this.rows().reduce((total, row) => total + row.labourCost, 0),
  );

  protected readonly cyclesHarvested = computed(
    () => new Set(this.rows().map((row) => row.cycleId)).size,
  );

  protected readonly columns: Column<Harvest>[] = [
    { key: 'reference', label: 'Reference', mono: true, value: (row) => row.reference },
    { key: 'cycle', label: 'Cycle', value: (row) => this.cycleRef(row.cycleId) },
    { key: 'land', label: 'Plot', value: (row) => this.landName(row.cycleId) },
    { key: 'batchNo', label: 'Batch', align: 'right', mono: true, value: (row) => row.batchNo },
    {
      key: 'harvestedOn',
      label: 'Cut',
      mono: true,
      value: (row) => formatDate(row.harvestedOn),
      sortValue: (row) => row.harvestedOn,
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
      key: 'grade',
      label: 'Grade',
      value: (row) => GRADE_SHORT[row.grade],
      badge: (row) => ({ label: `Grade ${GRADE_SHORT[row.grade]}`, tone: this.gradeTone(row) }),
    },
    {
      key: 'labourCost',
      label: 'Labour',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.labourCost),
      sortValue: (row) => row.labourCost,
    },
    {
      key: 'achieved',
      label: 'Cycle so far',
      align: 'right',
      mono: true,
      value: (row) => this.achieved(row),
      sortValue: (row) => row.quantity,
    },
  ];

  protected gradeTone(row: Harvest): Tone {
    switch (row.grade) {
      case 'a':
        return 'ok';
      case 'b':
        return 'warn';
      default:
        return 'bad';
    }
  }

  /** What the cycle has reached, as a percentage of what was expected. */
  protected achieved(row: Harvest): string {
    const cycle = this.cycles().find((item) => item.id === row.cycleId);
    if (!cycle) {
      return '—';
    }
    return `${formatMaund(harvestedSoFar(cycle.id, this.all()))} · ${yieldAchieved(cycle, this.all())}%`;
  }

  protected cycleRef(cycleId: string): string {
    return this.cycles().find((row) => row.id === cycleId)?.reference ?? '—';
  }

  protected landName(cycleId: string): string {
    const cycle = this.cycles().find((row) => row.id === cycleId);
    return this.lands().find((row) => row.id === cycle?.landId)?.name ?? '—';
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected clearError(): void {
    this.store.dispatch(harvestsFeature.actions.clearError());
  }
}
