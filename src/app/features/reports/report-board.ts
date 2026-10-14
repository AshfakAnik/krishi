import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { formatArea, formatMaund, formatTaka } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  cropsFeature,
  cultivationCyclesFeature,
  farmingActivitiesFeature,
  harvestsFeature,
  landsFeature,
  partiesFeature,
  salesFeature,
  seasonsFeature,
  settlementsFeature,
} from '../../core/store/features';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { EmptyState } from '../../shared/ui/empty-state';

interface Row {
  key: string;
  label: string;
  detail: string;
  area: number;
  expected: number;
  harvested: number;
  proceeds: number;
  costs: number;
  margin: number;
}

/**
 * Read-only, and derived entirely from what the other modules recorded.
 *
 * A departure from MODULE_RECIPE with no apology: there is nothing to submit and
 * nothing to decide, so there is no form, no detail page and no rules file. What
 * a report needs instead is that every figure traces to a record somebody
 * entered — so each row is built from the collections rather than from stored
 * totals that could drift out of step with them.
 */
@Component({
  selector: 'app-report-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, KpiTile, PageHeader, SectionCard],
  templateUrl: './report-board.html',
  styleUrl: './report-board.css',
})
export class ReportBoard {
  private readonly store = inject(Store);
  protected readonly session = inject(SessionService);

  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly harvests = this.store.selectSignal(harvestsFeature.selectors.all);
  private readonly sales = this.store.selectSignal(salesFeature.selectors.all);
  private readonly activities = this.store.selectSignal(farmingActivitiesFeature.selectors.all);
  private readonly ledger = this.store.selectSignal(advancesFeature.selectors.all);
  private readonly settlements = this.store.selectSignal(settlementsFeature.selectors.all);

  constructor() {
    for (const feature of [
      cultivationCyclesFeature,
      landsFeature,
      cropsFeature,
      seasonsFeature,
      partiesFeature,
      agreementsFeature,
      harvestsFeature,
      salesFeature,
      farmingActivitiesFeature,
      advancesFeature,
      settlementsFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  /** One record per cycle, with everything downstream folded onto it. Every
   *  other report is a grouping of these. */
  private readonly perCycle = computed(() =>
    this.cycles().map((cycle) => {
      const land = this.lands().find((row) => row.id === cycle.landId);
      const harvested = this.harvests()
        .filter((row) => row.cycleId === cycle.id)
        .reduce((total, row) => total + row.quantity, 0);
      const proceeds = this.sales()
        .filter((row) => row.cycleId === cycle.id)
        .reduce((total, row) => total + row.netAmount, 0);
      const costs = this.activities()
        .filter((row) => row.cycleId === cycle.id)
        .reduce((total, row) => total + row.amount, 0);
      const harvestLabour = this.harvests()
        .filter((row) => row.cycleId === cycle.id)
        .reduce((total, row) => total + row.labourCost, 0);
      return {
        cycle,
        land,
        area: land?.area ?? 0,
        expected: cycle.expectedYield,
        harvested,
        proceeds,
        costs: costs + harvestLabour,
        margin: proceeds - costs - harvestLabour,
      };
    }),
  );

  private group(
    keyOf: (
      row: ReturnType<typeof this.perCycle>[number],
    ) => { key: string; label: string; detail: string } | null,
  ): Row[] {
    const groups = new Map<string, Row>();
    for (const item of this.perCycle()) {
      const identity = keyOf(item);
      if (!identity) {
        continue;
      }
      const existing = groups.get(identity.key) ?? {
        ...identity,
        area: 0,
        expected: 0,
        harvested: 0,
        proceeds: 0,
        costs: 0,
        margin: 0,
      };
      groups.set(identity.key, {
        ...existing,
        area: existing.area + item.area,
        expected: existing.expected + item.expected,
        harvested: existing.harvested + item.harvested,
        proceeds: existing.proceeds + item.proceeds,
        costs: existing.costs + item.costs,
        margin: existing.margin + item.margin,
      });
    }
    return [...groups.values()].sort((a, b) => b.proceeds - a.proceeds);
  }

  protected readonly byLand = computed(() =>
    this.group((item) =>
      item.land ? { key: item.land.id, label: item.land.name, detail: item.land.code } : null,
    ),
  );

  protected readonly bySharecropper = computed(() =>
    this.group((item) => {
      if (!item.cycle.sharecropperId) {
        return { key: 'owner', label: 'Owner-farmed', detail: 'No sharecropper' };
      }
      const party = this.parties().find((row) => row.id === item.cycle.sharecropperId);
      return {
        key: item.cycle.sharecropperId,
        label: party?.name ?? '—',
        detail: party?.village ?? '',
      };
    }),
  );

  protected readonly byCrop = computed(() =>
    this.group((item) => {
      const crop = this.crops().find((row) => row.id === item.cycle.cropId);
      return { key: item.cycle.cropId, label: crop?.name ?? '—', detail: '' };
    }),
  );

  protected readonly bySeason = computed(() =>
    this.group((item) => {
      const season = this.seasons().find((row) => row.id === item.cycle.seasonId);
      return {
        key: item.cycle.seasonId,
        label: season?.name ?? '—',
        detail: season ? `${season.startsOn} to ${season.endsOn}` : '',
      };
    }),
  );

  protected readonly totals = computed(() =>
    this.perCycle().reduce(
      (totals, item) => ({
        proceeds: totals.proceeds + item.proceeds,
        costs: totals.costs + item.costs,
        margin: totals.margin + item.margin,
        harvested: totals.harvested + item.harvested,
      }),
      { proceeds: 0, costs: 0, margin: 0, harvested: 0 },
    ),
  );

  protected readonly outstandingDadhon = computed(() =>
    this.ledger()
      .filter((row) => row.status === 'active')
      .reduce((total, row) => total + row.outstanding, 0),
  );

  protected readonly settledCount = computed(
    () => this.settlements().filter((row) => row.status === 'closed').length,
  );

  protected readonly agreementCount = computed(
    () => this.agreements().filter((row) => row.status === 'active').length,
  );

  protected readonly hasAnything = computed(() => this.perCycle().length > 0);

  /** Achieved against expected, as a percentage — the number an owner compares
   *  between seasons. */
  protected achieved(row: Row): string {
    return row.expected ? `${Math.round((row.harvested / row.expected) * 100)}%` : '—';
  }

  protected area(decimals: number): string {
    return formatArea(decimals);
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }
}
