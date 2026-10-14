import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { FARMING_TYPE_LABELS } from '../../core/models/agriculture';
import { Tone, formatDate, formatMaund } from '../../core/models/common';
import { CYCLE_STATUS_LABELS, CultivationCycle } from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  cultivationCyclesFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Column, DataTable } from '../../shared/ui/data-table';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { CycleForm } from './cycle-form';
import { occupies } from './cycle-rules';
import { cycleTone } from './cycle-view';

/** Every cycle, however it was opened: by approving an agreement, or by an owner
 *  deciding to farm a plot themselves. */
@Component({
  selector: 'app-cycle-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, DataTable, KpiTile, PageHeader, Icon, CycleForm],
  templateUrl: './cycle-list.html',
  styleUrl: './cycle-list.css',
})
export class CycleList {
  private readonly store = inject(Store);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(cultivationCyclesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(cultivationCyclesFeature.selectors.error);

  protected readonly formOpen = signal(false);

  constructor() {
    for (const feature of [
      cultivationCyclesFeature,
      landsFeature,
      cropsFeature,
      cropVarietiesFeature,
      partiesFeature,
      seasonsFeature,
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
    if (actor.role === 'sharecropper') {
      return all.filter((row) => row.sharecropperId === actor.id);
    }
    const mine = new Set(
      this.lands()
        .filter((land) => land.ownerId === actor.id)
        .map((land) => land.id),
    );
    return all.filter((row) => mine.has(row.landId));
  });

  protected readonly liveCount = computed(() => this.rows().filter(occupies).length);

  protected readonly ownerFarmedCount = computed(
    () => this.rows().filter((row) => row.farmingType === 'owner').length,
  );

  protected readonly expectedTotal = computed(() =>
    this.rows()
      .filter(occupies)
      .reduce((total, row) => total + row.expectedYield, 0),
  );

  protected readonly columns: Column<CultivationCycle>[] = [
    { key: 'reference', label: 'Cycle', mono: true, value: (row) => row.reference },
    { key: 'land', label: 'Plot', value: (row) => this.landName(row.landId) },
    { key: 'season', label: 'Season', value: (row) => this.seasonName(row.seasonId) },
    { key: 'crop', label: 'Crop', value: (row) => this.cropName(row.cropId) },
    { key: 'variety', label: 'Variety', value: (row) => this.varietyName(row.varietyId) },
    {
      key: 'farmingType',
      label: 'Farming',
      value: (row) => FARMING_TYPE_LABELS[row.farmingType],
    },
    { key: 'worker', label: 'Worked by', value: (row) => this.workedBy(row) },
    {
      key: 'expectedYield',
      label: 'Expected',
      align: 'right',
      mono: true,
      value: (row) => formatMaund(row.expectedYield),
      sortValue: (row) => row.expectedYield,
    },
    {
      key: 'status',
      label: 'Status',
      value: (row) => CYCLE_STATUS_LABELS[row.status],
      badge: (row) => ({
        label: CYCLE_STATUS_LABELS[row.status],
        tone: cycleTone(row.status),
      }),
    },
  ];

  protected readonly rowLink = (row: CultivationCycle): (string | number)[] => ['/cycles', row.id];

  protected landName(id: string): string {
    return this.lands().find((row) => row.id === id)?.name ?? '—';
  }

  protected cropName(id: string): string {
    return this.crops().find((row) => row.id === id)?.name ?? '—';
  }

  protected varietyName(id: string): string {
    return this.varieties().find((row) => row.id === id)?.name ?? '—';
  }

  protected seasonName(id: string): string {
    return this.seasons().find((row) => row.id === id)?.name ?? '—';
  }

  /** An owner-farming cycle has no tenant — the agreement reference is what
   *  distinguishes the two at a glance. */
  protected workedBy(row: CultivationCycle): string {
    if (row.farmingType === 'owner') {
      return 'The owner';
    }
    const tenant = this.parties().find((party) => party.id === row.sharecropperId);
    const agreement = this.agreements().find((item) => item.id === row.agreementId);
    return `${tenant?.name ?? '—'}${agreement ? ` · ${agreement.reference}` : ''}`;
  }

  protected started(row: CultivationCycle): string {
    return formatDate(row.startedOn);
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected queueTone(): Tone {
    return this.liveCount() ? 'brand' : 'neutral';
  }

  protected clearError(): void {
    this.store.dispatch(cultivationCyclesFeature.actions.clearError());
  }
}
