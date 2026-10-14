import { Injectable } from '@angular/core';
import { SEASON_ANCHOR, addDays } from './models/common';

/**
 * The session's idea of "now".
 *
 * The seed is anchored to `SEASON_ANCHOR` so its numbers are stable across
 * reloads. Runtime writes used to stamp the real wall clock instead, which put
 * every new audit row a year or more after every seeded one and made the audit
 * page unreadable as a timeline — a row written during the demo sorted above
 * rows describing the season it belongs to.
 *
 * So the whole app reads its date from here. The session opens the day after
 * the last seeded event and then advances in real time, which keeps elapsed
 * durations honest (a write two minutes later is stamped two minutes later)
 * while keeping the timeline continuous with the seed.
 */

/**
 * The day after the **last** seeded event of any kind, at the hour work starts,
 * so runtime rows continue that history rather than interleaving with it.
 *
 * That is `SEASON_ANCHOR + 138`, the seeded sale — not the last audit row at
 * +41, which is what this used to track. When Lane 4 landed, its harvest,
 * processing and sale seeds all fell *after* the session clock, which made the
 * seeded chain unfinishable: closing the running batch stamps today's date, and
 * a batch cannot finish before it began. Every seed date has to sit behind the
 * clock, not merely the audit ones.
 */
const SESSION_OPENS_AT = `${addDays(SEASON_ANCHOR, 139)}T09:00:00.000Z`;

@Injectable({ providedIn: 'root' })
export class SessionClock {
  private readonly origin = Date.parse(SESSION_OPENS_AT);
  /** Real time at construction. Only ever used as a delta, never as a date. */
  private readonly bootedAt = Date.now();

  now(): Date {
    return new Date(this.origin + (Date.now() - this.bootedAt));
  }

  /** ISO date, `YYYY-MM-DD`. What every `*On` field on a record stores. */
  today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  /** The season's year, for references like `CYC-2025-003`. */
  year(): number {
    return this.now().getUTCFullYear();
  }

  /** `YYYY-MM-DD HH:mm` — the format the audit table renders and sorts on. */
  stamp(): string {
    return this.now().toISOString().slice(0, 16).replace('T', ' ');
  }
}
