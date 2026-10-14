import { Injectable } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';
import { ApiService } from '../api-service';
import { CollectionKey, MOCK_DB } from './mock-db';

/** Simulated round-trip, so loading states are real rather than theoretical. */
const LATENCY_MS = 250;

interface HasId {
  id: string;
}

/**
 * Stands in for an HTTP backend. Holds a mutable working copy of MOCK_DB so
 * creates and edits survive navigation within a session; a page reload resets
 * to the seed, which is an accepted trade-off for a mock app.
 */
@Injectable({ providedIn: 'root' })
export class MockApiService implements ApiService {
  private readonly db = structuredClone(MOCK_DB) as Record<string, HasId[]>;

  list<T extends HasId>(collection: CollectionKey): Observable<T[]> {
    // Deep clone, not `.slice()`: a shallow copy hands out the live row objects,
    // so the store would end up holding references into the database and any
    // mutation would bypass it. Same argument as `peek()` below.
    return of(structuredClone(this.rows<T>(collection))).pipe(delay(LATENCY_MS));
  }

  get<T extends HasId>(collection: CollectionKey, id: string): Observable<T> {
    const found = this.rows<T>(collection).find((row) => row.id === id);
    return found
      ? of(structuredClone(found)).pipe(delay(LATENCY_MS))
      : throwError(() => new Error(`${collection}/${id} not found`)).pipe(delay(LATENCY_MS));
  }

  create<T extends HasId>(collection: CollectionKey, row: T): Observable<T> {
    this.rows<T>(collection).push(row);
    return of(structuredClone(row)).pipe(delay(LATENCY_MS));
  }

  update<T extends HasId>(collection: CollectionKey, row: T): Observable<T> {
    const rows = this.rows<T>(collection);
    const index = rows.findIndex((existing) => existing.id === row.id);
    if (index === -1) {
      // Delayed like every other path: emitting synchronously here would
      // dispatch the failure action re-entrantly, on the stack of the original
      // store.dispatch().
      return throwError(() => new Error(`${collection}/${row.id} not found`)).pipe(
        delay(LATENCY_MS),
      );
    }
    rows[index] = row;
    return of(structuredClone(row)).pipe(delay(LATENCY_MS));
  }

  /** Insert-or-replace a set of rows in one round trip. This is the only way
   *  to CREATE a record: `update()` cannot find an id the database has never
   *  seen, and a batch write should not be N round trips. */
  putMany<T extends HasId>(collection: CollectionKey, incoming: T[]): Observable<T[]> {
    const rows = this.rows<T>(collection);
    for (const row of incoming) {
      const index = rows.findIndex((existing) => existing.id === row.id);
      if (index === -1) {
        rows.push(row);
      } else {
        rows[index] = row;
      }
    }
    return of(structuredClone(incoming)).pipe(delay(LATENCY_MS));
  }

  remove(collection: CollectionKey, id: string): Observable<string> {
    const rows = this.rows(collection);
    const index = rows.findIndex((row) => row.id === id);
    if (index > -1) {
      rows.splice(index, 1);
    }
    return of(id).pipe(delay(LATENCY_MS));
  }

  /**
   * Synchronous read for cross-module lookups that are not worth a store —
   * a dashboard rolling up several collections, for instance.
   *
   * Returns a copy: handing out the live array would let any caller mutate the
   * database behind the store's back, and the store would never know.
   */
  peek<T extends HasId>(collection: CollectionKey): T[] {
    return structuredClone(this.rows<T>(collection));
  }

  private rows<T extends HasId = HasId>(collection: CollectionKey): T[] {
    return this.db[collection] as T[];
  }
}
