import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AGREEMENT_STATUS_LABELS, SharecroppingAgreement } from '../../core/models/agreement';
import { LAND_TYPE_LABELS } from '../../core/models/agriculture';
import { formatArea, formatDate, formatMaund, formatTaka } from '../../core/models/common';
import { CYCLE_STATUS_LABELS, CultivationCycle } from '../../core/models/cultivation';
import { advanceCeiling, committedAgainst, headroom } from '../../core/rules/dadhon';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  cropsFeature,
  cultivationCyclesFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Field, FieldList } from '../../shared/ui/field-list';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { agreementTone } from '../agreements/agreement-view';
import { LandForm } from './land-form';
import { deletionBlocker, isHeld, lockedFields, suitableCrops } from './land-rules';

/**
 * One plot, and everything that has happened on it.
 *
 * A plot has no decision of its own, so what fills the detail page instead is
 * the history other modules wrote against it: which agreements committed it,
 * which cycles ran, and what dadhon its area can carry.
 */
@Component({
  selector: 'app-land-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, FieldList, Icon, PageHeader, SectionCard, StatusBadge, LandForm],
  templateUrl: './land-detail.html',
  styleUrl: './land-detail.css',
})
export class LandDetail {
  readonly id = input.required<string>();

  private readonly store = inject(Store);
  protected readonly session = inject(SessionService);

  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly agreementRows = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly cycleRows = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly ledger = this.store.selectSignal(advancesFeature.selectors.all);

  protected readonly error = this.store.selectSignal(landsFeature.selectors.error);
  protected readonly editing = signal(false);

  constructor() {
    for (const feature of [
      landsFeature,
      agreementsFeature,
      cultivationCyclesFeature,
      partiesFeature,
      seasonsFeature,
      cropsFeature,
      advancesFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly land = computed(() => this.lands().find((row) => row.id === this.id()));

  protected readonly agreements = computed(() =>
    this.agreementRows().filter((row) => row.landId === this.id()),
  );

  protected readonly cycles = computed(() =>
    this.cycleRows().filter((row) => row.landId === this.id()),
  );

  protected readonly holder = computed(() =>
    this.agreementRows().find((row) => row.id === this.land()?.heldByAgreementId),
  );

  protected readonly held = computed(() => {
    const land = this.land();
    return land ? isHeld(land) : false;
  });

  protected readonly locked = computed(() => {
    const land = this.land();
    return land ? lockedFields(land, this.agreementRows()) : [];
  });

  protected readonly blocker = computed(() => {
    const land = this.land();
    return land ? deletionBlocker(land, this.agreementRows(), this.cycleRows()) : '';
  });

  protected readonly ceiling = computed(() => advanceCeiling(this.land()));

  /** The dadhon standing of whichever agreement holds the plot right now. */
  protected readonly committed = computed(() => {
    const agreement = this.holder();
    return agreement ? committedAgainst(agreement.id, this.ledger()) : 0;
  });

  protected readonly available = computed(() => {
    const agreement = this.holder();
    return agreement ? headroom(this.land(), agreement.id, this.ledger()) : this.ceiling();
  });

  protected readonly growable = computed(() => suitableCrops(this.land(), this.crops()));

  protected readonly summary = computed<Field[]>(() => {
    const land = this.land();
    if (!land) {
      return [];
    }
    return [
      { label: 'Dag code', value: land.code, mono: true },
      { label: 'Local name', value: land.name },
      { label: 'Land type', value: LAND_TYPE_LABELS[land.landType] },
      { label: 'Area', value: formatArea(land.area), mono: true },
      { label: 'Location', value: land.location },
      { label: 'Owner', value: this.partyName(land.ownerId) },
      {
        label: 'Currently held by',
        value: this.holder() ? `${this.holder()!.reference}` : 'Nobody — the plot is free',
      },
    ];
  });

  protected agreementLabel(row: SharecroppingAgreement): string {
    return AGREEMENT_STATUS_LABELS[row.status];
  }

  protected agreementBadge(row: SharecroppingAgreement) {
    return agreementTone(row.status);
  }

  protected cycleLabel(row: CultivationCycle): string {
    return CYCLE_STATUS_LABELS[row.status];
  }

  protected partyName(id: string | null): string {
    return this.parties().find((party) => party.id === id)?.name ?? '—';
  }

  protected seasonName(id: string): string {
    return this.seasons().find((season) => season.id === id)?.name ?? '—';
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected clearError(): void {
    this.store.dispatch(landsFeature.actions.clearError());
  }
}
