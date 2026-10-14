import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { CollectionKey, MOCK_DB } from '../mock-db/mock-db';

interface Row {
  id: string;
}

const DB_NAME = 'krishi';

/**
 * Offline storage. One table holds every collection as JSON documents, so the
 * 19 collections need no per-table schema and a new field never needs a
 * migration. On a phone this is real SQLite (`@capacitor-community/sqlite`);
 * in a desktop browser (`ng serve`) it falls back to an in-memory copy.
 *
 * The first launch seeds the table from `MOCK_DB`, which is the dummy data.
 */
@Injectable({ providedIn: 'root' })
export class LocalDb {
  private ready: Promise<void> | null = null;
  private conn: SQLiteDBConnection | null = null;
  private memory: Record<string, Row[]> = {};

  /** True when rows are persisted in SQLite rather than held in memory. */
  readonly persistent = Capacitor.isNativePlatform();

  init(): Promise<void> {
    this.ready ??= this.persistent ? this.openSqlite() : this.openMemory();
    return this.ready;
  }

  async all<T extends Row>(collection: CollectionKey): Promise<T[]> {
    await this.init();
    if (!this.conn) {
      return structuredClone((this.memory[collection] ?? []) as T[]);
    }
    const result = await this.conn.query('SELECT json FROM docs WHERE collection = ? ORDER BY rowid', [collection]);
    return (result.values ?? []).map((r) => JSON.parse(r['json'] as string) as T);
  }

  async one<T extends Row>(collection: CollectionKey, id: string): Promise<T | undefined> {
    await this.init();
    if (!this.conn) {
      return structuredClone((this.memory[collection] ?? []).find((r) => r.id === id) as T | undefined);
    }
    const result = await this.conn.query('SELECT json FROM docs WHERE collection = ? AND id = ?', [collection, id]);
    const json = result.values?.[0]?.['json'] as string | undefined;
    return json ? (JSON.parse(json) as T) : undefined;
  }

  /** Insert or replace, keeping the row's original position on replace. */
  async put<T extends Row>(collection: CollectionKey, row: T): Promise<void> {
    await this.init();
    if (!this.conn) {
      const rows = (this.memory[collection] ??= []);
      const copy = structuredClone(row);
      const index = rows.findIndex((r) => r.id === row.id);
      if (index === -1) {
        rows.push(copy);
      } else {
        rows[index] = copy;
      }
      return;
    }
    await this.conn.run(
      'INSERT INTO docs (collection, id, json) VALUES (?, ?, ?) ' +
        'ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json',
      [collection, row.id, JSON.stringify(row)],
    );
  }

  async remove(collection: CollectionKey, id: string): Promise<void> {
    await this.init();
    if (!this.conn) {
      this.memory[collection] = (this.memory[collection] ?? []).filter((r) => r.id !== id);
      return;
    }
    await this.conn.run('DELETE FROM docs WHERE collection = ? AND id = ?', [collection, id]);
  }

  /** Wipes everything and re-seeds the dummy data. */
  async reset(): Promise<void> {
    await this.init();
    if (!this.conn) {
      this.memory = structuredClone(MOCK_DB) as Record<string, Row[]>;
      return;
    }
    await this.conn.run('DELETE FROM docs');
    await this.seed(this.conn);
  }

  private openMemory(): Promise<void> {
    this.memory = structuredClone(MOCK_DB) as Record<string, Row[]>;
    return Promise.resolve();
  }

  private async openSqlite(): Promise<void> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const existing = (await sqlite.isConnection(DB_NAME, false)).result;
    const conn = existing
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    await conn.open();
    await conn.execute(
      'CREATE TABLE IF NOT EXISTS docs (' +
        'collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, ' +
        'PRIMARY KEY (collection, id))',
    );
    const count = await conn.query('SELECT COUNT(*) AS n FROM docs');
    if (!Number(count.values?.[0]?.['n'] ?? 0)) {
      await this.seed(conn);
    }
    this.conn = conn;
  }

  private async seed(conn: SQLiteDBConnection): Promise<void> {
    const set = Object.entries(MOCK_DB).flatMap(([collection, rows]) =>
      (rows as Row[]).map((row) => ({
        statement: 'INSERT OR REPLACE INTO docs (collection, id, json) VALUES (?, ?, ?)',
        values: [collection, row.id, JSON.stringify(row)],
      })),
    );
    await conn.executeSet(set, true);
  }
}
