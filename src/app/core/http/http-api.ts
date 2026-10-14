import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiService } from '../api-service';
import { StockLot } from '../models/harvest';
import { CollectionKey } from '../mock-db/mock-db';
import { MockApiService } from '../mock-db/mock-api';
import { OfflineApiService } from '../offline/offline-api';

interface HasId {
  id: string;
}

/**
 * Collections the real backend actually serves today. Every module's
 * decision methods now call real action endpoints (`action()`, below)
 * instead of PUTting a client-computed object.
 *
 * `auditLogs` reads from the real backend too: rows are written
 * automatically server-side (one per mutating endpoint, via the backend's
 * `AuditAspect`), and the audit trail page now lists those, not a
 * client-side echo. `AuditLogService.record()` still fires on every write
 * and still lands in `MockApiService`'s in-memory array — nothing reads
 * that array anymore, so those calls are now a harmless no-op kept only
 * because removing 30+ call sites is a separate pass.
 */
const REAL_COLLECTIONS: ReadonlySet<CollectionKey> = new Set<CollectionKey>([
  'seasons',
  'lands',
  'crops',
  'cropVarieties',
  'parties',
  'harvests',
  'sales',
  'farmingActivities',
  'agreements',
  'advances',
  'cultivationCycles',
  'calendarTasks',
  'monitoringLogs',
  'processingBatches',
  'stockLots',
  'settlements',
  'disputes',
  'financeEntries',
  'auditLogs',
]);

/**
 * The one collection whose `CollectionKey` doesn't match its backend
 * `@RequestMapping` path 1:1 — `financeEntries` is served at `/api/finance`.
 * Every other real collection's key is also its URL segment.
 */
const PATH_OVERRIDES: Partial<Record<CollectionKey, string>> = {
  financeEntries: 'finance',
};

/**
 * Fields whose value is a TS union like `'harvest-labour'` on the wire the
 * frontend already speaks, but a Java enum constant (`HARVEST_LABOUR`) on
 * the backend's. Every one of these follows the same rule in both
 * directions — lowercase+hyphen vs. uppercase+underscore — confirmed
 * against every enum built this session (`QualityGrade`, `LandType`,
 * `ActivityKind`, `CostLine`, `ResponsibleParty`, `RoleName`,
 * `AgreementStatus`, `SharecroppingModel`, `AdvanceKind`/`AdvanceStatus`,
 * `FarmingType`/`CycleStatus`), so one pair of generic functions handles
 * all of them; only *which* fields need the conversion is
 * collection-specific, kept explicit here rather than guessed at, so a
 * free-text field (`buyer`, `note`, `name`, ...) is never touched by
 * accident. A dotted path (`'terms.model'`) reaches one level into a
 * nested object — `agreements` is the only collection that needs it.
 */
const ENUM_FIELDS: Partial<Record<CollectionKey, readonly string[]>> = {
  lands: ['landType'],
  crops: ['suitableLandTypes'],
  parties: ['role', 'status'],
  harvests: ['grade'],
  farmingActivities: ['kind', 'costLine', 'bearer'],
  agreements: [
    'status',
    'terms.model',
    'terms.costResponsibility',
    'terms.labourResponsibility',
    'terms.machineryResponsibility',
    'terms.inputResponsibility',
    'terms.settlementMode',
  ],
  advances: ['kind', 'status'],
  cultivationCycles: ['farmingType', 'status'],
  calendarTasks: ['stage', 'status'],
  monitoringLogs: ['kind', 'stage', 'cause'],
  processingBatches: ['process', 'status'],
  stockLots: ['grade', 'heldFor'],
  settlements: ['mode', 'status'],
  disputes: ['reroute', 'status'],
  financeEntries: ['kind', 'status'],
};

@Injectable({ providedIn: 'root' })
export class HttpApiService implements ApiService {
  private readonly http = inject(HttpClient);
  private readonly mock = inject(MockApiService);
  private readonly offline = inject(OfflineApiService);

  list<T extends HasId>(collection: CollectionKey): Observable<T[]> {
    if (environment.offline) {
      return this.offline.list<T>(collection);
    }
    if (!REAL_COLLECTIONS.has(collection)) {
      return this.mock.list<T>(collection);
    }
    return this.http
      .get<T[]>(this.url(collection))
      .pipe(map((rows) => rows.map((row) => fromWire(collection, row))), catchError(mapError));
  }

  get<T extends HasId>(collection: CollectionKey, id: string): Observable<T> {
    if (environment.offline) {
      return this.offline.get<T>(collection, id);
    }
    if (!REAL_COLLECTIONS.has(collection)) {
      return this.mock.get<T>(collection, id);
    }
    return this.http
      .get<T>(this.url(collection, id))
      .pipe(map((row) => fromWire(collection, row)), catchError(mapError));
  }

  create<T extends HasId>(collection: CollectionKey, row: T): Observable<T> {
    if (environment.offline) {
      return this.offline.create<T>(collection, row);
    }
    if (!REAL_COLLECTIONS.has(collection)) {
      return this.mock.create<T>(collection, row);
    }
    return this.http
      .post<T>(this.url(collection), toWire(collection, row))
      .pipe(map((saved) => fromWire(collection, saved)), catchError(mapError));
  }

  update<T extends HasId>(collection: CollectionKey, row: T): Observable<T> {
    if (environment.offline) {
      return this.offline.update<T>(collection, row);
    }
    if (!REAL_COLLECTIONS.has(collection)) {
      return this.mock.update<T>(collection, row);
    }
    return this.http
      .put<T>(this.url(collection, row.id), toWire(collection, row))
      .pipe(map((saved) => fromWire(collection, saved)), catchError(mapError));
  }

  /**
   * The mock's `putMany` is how every module creates a row (see its own
   * comment: `update()` can't find an id the backend has never seen). The
   * real backend has no equivalent bulk-upsert endpoint, only per-resource
   * POST (create) and, where a module allows a free-form edit, PUT. So each
   * row is POSTed; a 409 (`DataIntegrityViolationException` — the id
   * already exists) means this was actually an edit, retried as PUT. This
   * lets reference-data list pages dispatch the same `upsertMany` for both
   * create and edit without the frontend needing to know which up front.
   */
  putMany<T extends HasId>(collection: CollectionKey, rows: T[]): Observable<T[]> {
    if (environment.offline) {
      return this.offline.putMany<T>(collection, rows);
    }
    if (!REAL_COLLECTIONS.has(collection)) {
      return this.mock.putMany<T>(collection, rows);
    }
    const puts = rows.map((row) =>
      this.http.post<T>(this.url(collection), toWire(collection, row)).pipe(
        catchError((error: HttpErrorResponse) =>
          error.status === 409
            ? this.http.put<T>(this.url(collection, row.id), toWire(collection, row))
            : throwError(() => error),
        ),
        map((saved) => fromWire(collection, saved)),
        catchError(mapError),
      ),
    );
    return forkJoinInOrder(puts);
  }

  remove(collection: CollectionKey, id: string): Observable<string> {
    if (environment.offline) {
      return this.offline.remove(collection, id);
    }
    if (!REAL_COLLECTIONS.has(collection)) {
      return this.mock.remove(collection, id);
    }
    // DELETE returns 204 with no body; the store expects the removed id back.
    return this.http.delete<void>(this.url(collection, id)).pipe(
      map(() => id),
      catchError(mapError),
    );
  }

  /**
   * Calls a decision/lifecycle action endpoint (`POST /{collection}/{id}/{verb}`)
   * — `approve`, `reject`, `revoke`, `repay`, `advance`, `abort`, and so on,
   * one per module's own controller. Not part of `ApiService`: `MockApiService`
   * has no equivalent (the mock never had actions, only compute-then-upsert),
   * and every collection this is called against is already real. Components
   * inject `HttpApiService` directly for this, not the `API` token.
   */
  action<T>(collection: CollectionKey, id: string, verb: string, body: unknown = {}): Observable<T> {
    if (environment.offline) {
      return this.offline.action<T>(collection, id, verb, body);
    }
    return this.http
      .post<T>(`${this.url(collection, id)}/${verb}`, body)
      .pipe(map((row) => fromWire(collection, row)), catchError(mapError));
  }

  /**
   * `StockLotController.split` is the one action endpoint that doesn't
   * return a single row of its own collection — it returns
   * `{ owner, sharecropper }`, two `stockLots` rows. `action()`'s generic
   * `fromWire(collection, row)` assumes `row` IS a collection row, so
   * applying it directly here would reach for `.grade`/`.heldFor` on the
   * wrapper itself rather than one level down and silently leave both
   * lots' enums in wire case. Convert each side individually instead.
   */
  splitStockLot(id: string): Observable<{ owner: StockLot; sharecropper: StockLot }> {
    if (environment.offline) {
      return this.offline.splitStockLot(id);
    }
    return this.http
      .post<{ owner: StockLot; sharecropper: StockLot }>(`${this.url('stockLots', id)}/split`, {})
      .pipe(
        map(({ owner, sharecropper }) => ({
          owner: fromWire('stockLots', owner),
          sharecropper: fromWire('stockLots', sharecropper),
        })),
        catchError(mapError),
      );
  }

  private url(collection: CollectionKey, id?: string): string {
    const segment = PATH_OVERRIDES[collection] ?? collection;
    return id ? `${environment.apiBaseUrl}/${segment}/${id}` : `${environment.apiBaseUrl}/${segment}`;
  }
}

/**
 * `collection-feature.ts`'s `describe()` only reads `.message` off a real
 * `Error` (`error instanceof Error ? error.message : String(error)`) — an
 * `HttpErrorResponse` is not one, so without this every real-backend
 * failure would render as `"[object Object]"` instead of the server's
 * actual `ApiError.message`.
 */
function mapError(error: HttpErrorResponse): Observable<never> {
  const message = (error.error as { message?: string } | null)?.message ?? error.message ?? 'Request failed.';
  return throwError(() => new Error(message));
}

function toWireEnum(value: string): string {
  return value.toUpperCase().replace(/-/g, '_');
}

function fromWireEnum(value: string): string {
  return value.toLowerCase().replace(/_/g, '-');
}

/** Frontend row → backend JSON: converts every field named in
 *  `ENUM_FIELDS` for this collection — string, array of strings, or one
 *  level into a nested object (`'terms.model'`) — everything else
 *  untouched. */
function toWire<T>(collection: CollectionKey, row: T): T {
  return applyEnumFields(collection, row, toWireEnum);
}

/** The inverse of `toWire`, applied to every response from a real
 *  collection so the row matches what the rest of the app (label maps,
 *  rules functions) already expects. */
function fromWire<T>(collection: CollectionKey, row: T): T {
  return applyEnumFields(collection, row, fromWireEnum);
}

function applyEnumFields<T>(collection: CollectionKey, row: T, transform: (value: string) => string): T {
  const fields = ENUM_FIELDS[collection];
  if (!fields) {
    return row;
  }
  const copy = { ...row } as Record<string, unknown>;
  for (const field of fields) {
    const dot = field.indexOf('.');
    if (dot === -1) {
      copy[field] = transformValue(copy[field], transform);
      continue;
    }
    const outer = field.slice(0, dot);
    const inner = field.slice(dot + 1);
    const nested = copy[outer];
    if (nested && typeof nested === 'object') {
      copy[outer] = { ...nested, [inner]: transformValue((nested as Record<string, unknown>)[inner], transform) };
    }
  }
  return copy as T;
}

function transformValue(value: unknown, transform: (value: string) => string): unknown {
  if (typeof value === 'string') {
    return transform(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? transform(v) : v));
  }
  return value;
}

/** `forkJoin` on an empty array emits nothing at all — `Rollback`'s callers
 *  always expect exactly one emission, even for a zero-length write. */
function forkJoinInOrder<T>(sources: Observable<T>[]): Observable<T[]> {
  if (sources.length === 0) {
    return new Observable<T[]>((subscriber) => {
      subscriber.next([]);
      subscriber.complete();
    });
  }
  return forkJoin(sources);
}
