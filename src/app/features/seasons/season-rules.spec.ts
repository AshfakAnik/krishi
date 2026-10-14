import { describe, expect, it } from 'vitest';
import { SharecroppingAgreement } from '../../core/models/agreement';
import { Season } from '../../core/models/agriculture';
import { CultivationCycle } from '../../core/models/cultivation';
import {
  MAX_SEASON_DAYS,
  SeasonContext,
  SeasonDraft,
  deletionBlocker,
  overlaps,
  seasonStanding,
  validateSeason,
} from './season-rules';

/**
 * One test per rule, plus the negative case. The negatives are the valuable
 * ones — a suite that only proves the happy path will not survive a refactor.
 */

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: 'season-aman-2025',
    name: 'Aman 2025',
    year: 2025,
    startsOn: '2025-06-15',
    endsOn: '2025-11-27',
    active: true,
    ...overrides,
  };
}

function draft(overrides: Partial<SeasonDraft> = {}): SeasonDraft {
  return {
    name: 'Boro 2025–26',
    year: 2026,
    startsOn: '2025-12-02',
    endsOn: '2026-05-01',
    active: true,
    ...overrides,
  };
}

function context(overrides: Partial<SeasonContext> = {}): SeasonContext {
  return { seasons: [season()], ...overrides };
}

describe('season windows', () => {
  it('accepts a season that clears every existing one', () => {
    expect(validateSeason(draft(), context())).toEqual({});
  });

  it('needs a name', () => {
    expect(validateSeason(draft({ name: '' }), context())).toHaveProperty('name');
  });

  it('refuses a duplicate name in the same year', () => {
    const existing = season({ id: 'other', name: 'Boro 2025–26', year: 2026 });
    expect(validateSeason(draft(), context({ seasons: [existing] }))).toHaveProperty('name');
  });

  it('allows the same name in a different year', () => {
    const existing = season({
      id: 'other',
      name: 'Boro 2025–26',
      year: 2025,
      startsOn: '2024-12-02',
      endsOn: '2025-05-01',
    });
    expect(validateSeason(draft(), context({ seasons: [existing] }))['name']).toBeUndefined();
  });

  it('must close after it opens', () => {
    expect(
      validateSeason(draft({ startsOn: '2026-05-01', endsOn: '2025-12-02' }), context()),
    ).toHaveProperty('endsOn');
  });

  it('refuses a window longer than a year', () => {
    const errors = validateSeason(
      draft({ startsOn: '2025-12-02', endsOn: '2027-01-01' }),
      context(),
    );
    expect(errors['endsOn']).toContain(String(MAX_SEASON_DAYS));
  });

  it('refuses a window overlapping another season', () => {
    // Starts a week before Aman closes.
    const errors = validateSeason(
      draft({ startsOn: '2025-11-20', endsOn: '2026-04-01' }),
      context(),
    );
    expect(errors['startsOn']).toContain('Aman 2025');
  });

  it('does not clash with itself while being edited', () => {
    const edit = draft({
      name: 'Aman 2025',
      year: 2025,
      startsOn: '2025-06-15',
      endsOn: '2025-11-27',
    });
    expect(validateSeason(edit, context({ ignoreSeasonId: 'season-aman-2025' }))).toEqual({});
  });

  it('treats a shared boundary day as an overlap', () => {
    // One day in two seasons is what lets a plot be committed twice.
    expect(
      overlaps(
        { startsOn: '2025-01-01', endsOn: '2025-06-15' },
        { startsOn: '2025-06-15', endsOn: '2025-12-01' },
      ),
    ).toBe(true);
    expect(
      overlaps(
        { startsOn: '2025-01-01', endsOn: '2025-06-14' },
        { startsOn: '2025-06-15', endsOn: '2025-12-01' },
      ),
    ).toBe(false);
  });
});

describe('where a season stands', () => {
  it('reads from the dates rather than a stored flag', () => {
    expect(seasonStanding(season(), '2025-06-01')).toBe('upcoming');
    expect(seasonStanding(season(), '2025-06-15')).toBe('open');
    expect(seasonStanding(season(), '2025-08-01')).toBe('open');
    expect(seasonStanding(season(), '2025-11-27')).toBe('open');
    expect(seasonStanding(season(), '2025-11-28')).toBe('closed');
  });
});

describe('removing a season', () => {
  const agreement = { id: 'agr-1', seasonId: 'season-aman-2025' } as SharecroppingAgreement;
  const cycle = { id: 'cyc-1', seasonId: 'season-aman-2025' } as CultivationCycle;

  it('is allowed when nothing points at it', () => {
    expect(deletionBlocker(season(), [], [])).toBe('');
  });

  it('is blocked by an agreement, and says how many', () => {
    expect(deletionBlocker(season(), [agreement], [])).toContain('1 agreement');
  });

  it('is blocked by a cultivation cycle', () => {
    expect(deletionBlocker(season(), [], [cycle])).toContain('1 cultivation cycle');
  });

  it('ignores records belonging to another season', () => {
    const elsewhere = { id: 'agr-2', seasonId: 'season-boro-2026' } as SharecroppingAgreement;
    expect(deletionBlocker(season(), [elsewhere], [])).toBe('');
  });
});
