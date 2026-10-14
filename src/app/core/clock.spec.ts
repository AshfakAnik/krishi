import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionClock } from './clock';
import { AUDIT_LOGS } from './mock-db/seed/audit';
import { SALES } from './mock-db/seed/harvest';

describe('SessionClock', () => {
  let clock: SessionClock;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    clock = TestBed.inject(SessionClock);
  });

  it('opens after the last seeded audit row, so the timeline is continuous', () => {
    const latestSeed = AUDIT_LOGS.map((row) => row.timestamp)
      .sort()
      .at(-1)!;
    expect(clock.stamp() > latestSeed).toBe(true);
  });

  it('opens after the last seeded sale, not merely the last audit row', () => {
    // The defect this guards: when Lane 4 landed, its harvest, processing and
    // sale seeds all fell *after* the session clock, which made the seeded
    // chain unfinishable — closing the running batch stamps today, and a batch
    // cannot finish before it began. Every seed date has to sit behind the
    // clock, not merely the audit ones.
    const latestSale = SALES.map((row) => row.soldOn)
      .sort()
      .at(-1)!;
    expect(clock.today() > latestSale).toBe(true);
  });

  it('stays on the seeded season rather than the real year', () => {
    expect(clock.year()).toBe(2025);
    expect(clock.today().startsWith('2025-')).toBe(true);
  });

  it('formats a stamp the audit table can sort as a string', () => {
    expect(clock.stamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('formats today as a bare ISO date', () => {
    expect(clock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('advances in real time rather than freezing', () => {
    const first = clock.now().getTime();
    // Busy-wait past the millisecond boundary; a fake timer would not exercise
    // the real-elapsed arithmetic this class exists for.
    const until = Date.now() + 2;
    while (Date.now() < until) {
      /* spin */
    }
    expect(clock.now().getTime()).toBeGreaterThan(first);
  });
});
