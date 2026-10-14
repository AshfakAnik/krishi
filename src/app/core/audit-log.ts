import { Injectable, inject } from '@angular/core';
import { SessionClock } from './clock';
import { MockApiService } from './mock-db/mock-api';

/**
 * Shape of an audit row. Declared here so the template is drop-in; move it into
 * `core/models/` once the app has a models folder, and add whatever extra
 * columns the domain needs.
 */
export interface AuditLogRow {
  id: string;
  actorRole: string;
  actorName: string;
  action: string;
  moduleName: string;
  details: string;
  timestamp: string;
}

export type AuditEntry = Omit<AuditLogRow, 'id' | 'timestamp'>;

/**
 * One `record()` call per write, anywhere in the app. This is what turns an
 * audit page from a fixture into an actual record of what happened.
 *
 * Deliberately fire-and-forget: an audit write must never block or fail the
 * user's action.
 */
@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly api = inject(MockApiService);
  private readonly clock = inject(SessionClock);
  private sequence = 0;

  record(entry: AuditEntry): void {
    // The session clock, not the wall clock: a runtime row has to sort into the
    // same timeline as the seeded ones or the audit page stops being readable
    // as a sequence of events.
    const row: AuditLogRow = {
      id: `audit-run-${this.sequence++}`,
      timestamp: this.clock.stamp(),
      ...entry,
    };
    // 'auditLogs' must exist as a collection in MOCK_DB.
    this.api.putMany('auditLogs', [row]).subscribe();
  }
}
