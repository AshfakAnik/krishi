import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { CollectionKey } from './mock-db/mock-db';

interface HasId {
  id: string;
}

/**
 * The interface both `MockApiService` and `HttpApiService` satisfy.
 * `collection-feature.ts`'s effects are written against this token, not
 * either concrete class, so which one actually serves a given collection
 * is an implementation detail of whichever class is provided for `API`.
 */
export interface ApiService {
  list<T extends HasId>(collection: CollectionKey): Observable<T[]>;
  get<T extends HasId>(collection: CollectionKey, id: string): Observable<T>;
  create<T extends HasId>(collection: CollectionKey, row: T): Observable<T>;
  update<T extends HasId>(collection: CollectionKey, row: T): Observable<T>;
  putMany<T extends HasId>(collection: CollectionKey, rows: T[]): Observable<T[]>;
  remove(collection: CollectionKey, id: string): Observable<string>;
}

export const API = new InjectionToken<ApiService>('API');
