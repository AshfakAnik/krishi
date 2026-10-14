import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogRow } from '../../core/audit-log';
import { auditLogsFeature } from '../../core/store/features';
import { Column, DataTable } from '../../shared/ui/data-table';
import { PageHeader } from '../../shared/ui/page-header';

/**
 * Read-only view of `AuditLogService.record(...)`. Every write in the app adds a
 * row here, which is what makes it a record rather than a fixture.
 */
@Component({
  selector: 'app-audit-trail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTable, PageHeader],
  templateUrl: './audit-trail.html',
  styleUrl: './audit-trail.css',
})
export class AuditTrail {
  private readonly store = inject(Store);

  protected readonly rows = this.store.selectSignal(auditLogsFeature.selectors.all);
  protected readonly loading = this.store.selectSignal(auditLogsFeature.selectors.loading);

  constructor() {
    this.store.dispatch(auditLogsFeature.actions.ensureLoaded());
  }

  protected readonly columns: Column<AuditLogRow>[] = [
    { key: 'timestamp', label: 'When', mono: true, value: (row) => row.timestamp },
    { key: 'actorName', label: 'Actor', value: (row) => row.actorName },
    { key: 'actorRole', label: 'Role', value: (row) => row.actorRole },
    { key: 'moduleName', label: 'Module', value: (row) => row.moduleName },
    { key: 'action', label: 'Action', value: (row) => row.action },
    { key: 'details', label: 'Details', value: (row) => row.details },
  ];
}
