import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { RESPONSIBLE_LABELS } from '../../core/models/agreement';
import { Tone, formatDate, formatTaka } from '../../core/models/common';
import {
  ACTIVITY_KIND_LABELS,
  COST_LINE_LABELS,
  FarmingActivity,
} from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cultivationCyclesFeature,
  farmingActivitiesFeature,
  landsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Column, DataTable } from '../../shared/ui/data-table';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { ActivityForm } from './activity-form';
import { costTotals } from './activity-rules';

/**
 * Every expense recorded against a cycle, and who ended up carrying it.
 *
 * No detail page: an activity is a single line, and everything about it is
 * already in the row. What the module needs instead is the running total per
 * side, which is the figure Lane 5 will settle.
 */
@Component({
  selector: 'app-activity-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, DataTable, KpiTile, PageHeader, Icon, ActivityForm],
  templateUrl: './activity-list.html',
  styleUrl: './activity-list.css',
})
export class ActivityList {
  private readonly store = inject(Store);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(farmingActivitiesFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(farmingActivitiesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(farmingActivitiesFeature.selectors.error);

  protected readonly formOpen = signal(false);

  constructor() {
    for (const feature of [
      farmingActivitiesFeature,
      cultivationCyclesFeature,
      landsFeature,
      agreementsFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  /** A sharecropper sees the cycles they work; an owner those on their land. */
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

  protected readonly totals = computed(() => costTotals(this.rows()));

  protected readonly columns: Column<FarmingActivity>[] = [
    { key: 'reference', label: 'Reference', mono: true, value: (row) => row.reference },
    { key: 'cycle', label: 'Cycle', value: (row) => this.cycleRef(row.cycleId) },
    { key: 'land', label: 'Plot', value: (row) => this.landName(row.cycleId) },
    { key: 'kind', label: 'Activity', value: (row) => ACTIVITY_KIND_LABELS[row.kind] },
    { key: 'costLine', label: 'Cost line', value: (row) => COST_LINE_LABELS[row.costLine] },
    {
      key: 'performedOn',
      label: 'Done',
      mono: true,
      value: (row) => formatDate(row.performedOn),
      sortValue: (row) => row.performedOn,
    },
    {
      key: 'amount',
      label: 'Cost',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.amount),
      sortValue: (row) => row.amount,
    },
    {
      key: 'ownerShare',
      label: 'Owner',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.ownerShare),
      sortValue: (row) => row.ownerShare,
    },
    {
      key: 'sharecropperShare',
      label: 'Sharecropper',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.sharecropperShare),
      sortValue: (row) => row.sharecropperShare,
    },
    {
      key: 'bearer',
      label: 'Borne by',
      value: (row) => RESPONSIBLE_LABELS[row.bearer],
      badge: (row) => ({ label: RESPONSIBLE_LABELS[row.bearer], tone: this.bearerTone(row) }),
    },
  ];

  protected bearerTone(row: FarmingActivity): Tone {
    switch (row.bearer) {
      case 'owner':
        return 'ok';
      case 'sharecropper':
        return 'brand';
      default:
        return 'neutral';
    }
  }

  protected cycleRef(cycleId: string): string {
    return this.cycles().find((row) => row.id === cycleId)?.reference ?? '—';
  }

  protected landName(cycleId: string): string {
    const cycle = this.cycles().find((row) => row.id === cycleId);
    return this.lands().find((row) => row.id === cycle?.landId)?.name ?? '—';
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected clearError(): void {
    this.store.dispatch(farmingActivitiesFeature.actions.clearError());
  }
}
