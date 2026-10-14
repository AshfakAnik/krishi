import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { HttpApiService } from '../../core/http/http-api';
import { Party } from '../../core/models/agriculture';
import { PARTY_STATUS_LABELS, PartyStatus, ROLE_LABELS, RoleName, Tone, formatTaka } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  landsFeature,
  partiesFeature,
} from '../../core/store/features';
import { watchUndoExpiry } from '../../core/store/undo-expiry';
import { Alert } from '../../shared/ui/alert';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { StatusBadge } from '../../shared/ui/status-badge';
import { PartyForm } from './party-form';
import { deletionBlocker, outstandingFor } from './party-rules';

/**
 * The party directory: owners, sharecroppers and staff in one list, because the
 * diagram treats them as parties to an agreement rather than three unrelated
 * directories.
 *
 * Administrator-only — this list is also the sign-in roster.
 */
@Component({
  selector: 'app-party-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, KpiTile, PageHeader, StatusBadge, Icon, PartyForm],
  templateUrl: './party-list.html',
  styleUrl: './party-list.css',
})
export class PartyList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  protected readonly rows = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly ledger = this.store.selectSignal(advancesFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(partiesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(partiesFeature.selectors.error);
  protected readonly undoable = this.store.selectSignal(partiesFeature.selectors.undoable);

  protected readonly editing = signal<Party | 'new' | null>(null);
  protected readonly blocked = signal('');

  constructor() {
    watchUndoExpiry(partiesFeature);
    for (const feature of [partiesFeature, landsFeature, agreementsFeature, advancesFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly ownerCount = computed(
    () => this.rows().filter((row) => row.role === 'owner').length,
  );

  protected readonly tenantCount = computed(
    () => this.rows().filter((row) => row.role === 'sharecropper').length,
  );

  protected readonly totalOutstanding = computed(() =>
    this.rows().reduce((total, row) => total + outstandingFor(row, this.ledger()), 0),
  );

  protected readonly editingParty = computed(() => {
    const value = this.editing();
    return value === 'new' || value === null ? null : value;
  });

  protected roleLabel(row: Party): string {
    return ROLE_LABELS[row.role];
  }

  protected roleTone(role: RoleName): Tone {
    switch (role) {
      case 'admin':
        return 'brand';
      case 'owner':
        return 'ok';
      default:
        return 'neutral';
    }
  }

  protected readonly statusLabels = PARTY_STATUS_LABELS;

  protected statusTone(status: PartyStatus): Tone {
    switch (status) {
      case 'active':
        return 'ok';
      case 'rejected':
        return 'bad';
      default:
        return 'warn';
    }
  }

  protected plotsOf(row: Party): number {
    return this.lands().filter((land) => land.ownerId === row.id).length;
  }

  protected agreementsOf(row: Party): number {
    return this.agreements().filter(
      (item) => item.ownerId === row.id || item.sharecropperId === row.id,
    ).length;
  }

  protected owed(row: Party): string {
    const amount = outstandingFor(row, this.ledger());
    return amount ? formatTaka(amount) : '—';
  }

  protected blockerFor(row: Party): string {
    return deletionBlocker(row, this.lands(), this.agreements(), this.ledger());
  }

  protected edit(row: Party): void {
    this.editing.set(row);
  }

  protected remove(row: Party): void {
    const blocker = this.blockerFor(row);
    if (blocker) {
      this.blocked.set(`${row.name} cannot be removed — ${blocker}`);
      return;
    }
    this.blocked.set('');
    this.store.dispatch(partiesFeature.actions.remove({ id: row.id }));
    this.log('Removed person', `${row.name} · ${ROLE_LABELS[row.role]}`);
  }

  protected undoRemove(): void {
    const row = this.undoable();
    if (!row) {
      return;
    }
    this.store.dispatch(partiesFeature.actions.undoRemove());
    this.log('Restored person', row.name);
  }

  /** Approves a self-service Owner/Sharecropper signup so it can sign in.
   *  Same pattern as agreement-detail.ts's approve()/reject(): the action
   *  endpoint returns the updated row, which replaces it in the store —
   *  nothing is computed client-side. */
  protected approve(row: Party): void {
    if (row.status !== 'pending') {
      return;
    }
    this.httpApi.action<Party>('parties', row.id, 'approve').subscribe({
      next: (updated) => {
        this.store.dispatch(partiesFeature.actions.upsertSuccess({ item: updated }));
        this.log('Approved account', `${row.name} · ${ROLE_LABELS[row.role]}`);
      },
    });
  }

  protected reject(row: Party): void {
    if (row.status !== 'pending') {
      return;
    }
    this.httpApi.action<Party>('parties', row.id, 'reject').subscribe({
      next: (updated) => {
        this.store.dispatch(partiesFeature.actions.upsertSuccess({ item: updated }));
        this.log('Rejected account', `${row.name} · ${ROLE_LABELS[row.role]}`);
      },
    });
  }

  protected clearError(): void {
    this.store.dispatch(partiesFeature.actions.clearError());
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  private log(action: string, details: string): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Owners & Sharecroppers',
      details,
    });
  }
}
