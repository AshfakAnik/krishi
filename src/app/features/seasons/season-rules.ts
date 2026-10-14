import { SharecroppingAgreement } from '../../core/models/agreement';
import { Season } from '../../core/models/agriculture';
import { daysBetween } from '../../core/models/common';
import { CultivationCycle } from '../../core/models/cultivation';

/**
 * Every rule of the Seasons module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import — same contract as every
 * other rules file here.
 *
 * Seasons are reference data, so this module has no approval step. What it has
 * instead is the integrity that reference data needs: a season other records
 * point at cannot be edited into a shape those records contradict, and cannot be
 * removed at all.
 */

/** A season longer than this is a data-entry slip, not a season. Aman runs about
 *  165 days; the longest local cycle is Boro at roughly 150. */
export const MAX_SEASON_DAYS = 366;

export interface SeasonDraft {
  name: string;
  year: number;
  startsOn: string;
  endsOn: string;
  active: boolean;
}

export interface SeasonContext {
  seasons: Season[];
  /** Set when editing, so a season does not clash with itself. */
  ignoreSeasonId?: string;
}

/** Two windows overlap if each starts before the other ends. Inclusive at both
 *  ends: a season ending the day another starts would put one day in both. */
export function overlaps(
  a: { startsOn: string; endsOn: string },
  b: { startsOn: string; endsOn: string },
): boolean {
  return a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
}

/** Where a season sits relative to a given day. Derived rather than stored: a
 *  stored "current season" flag is wrong the morning after it closes. */
export function seasonStanding(
  season: { startsOn: string; endsOn: string },
  today: string,
): 'upcoming' | 'open' | 'closed' {
  if (today < season.startsOn) {
    return 'upcoming';
  }
  return today > season.endsOn ? 'closed' : 'open';
}

export function validateSeason(draft: SeasonDraft, context: SeasonContext): Record<string, string> {
  const errors: Record<string, string> = {};
  const others = context.seasons.filter((row) => row.id !== context.ignoreSeasonId);

  if (draft.name.trim().length < 3) {
    errors['name'] = 'Give the season a name, such as Aman 2025.';
  } else if (
    others.some(
      (row) =>
        row.year === draft.year &&
        row.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
    )
  ) {
    errors['name'] = `There is already a season called ${draft.name.trim()} in ${draft.year}.`;
  }

  if (!draft.startsOn) {
    errors['startsOn'] = 'Give the date the season opens.';
  }

  if (!draft.endsOn) {
    errors['endsOn'] = 'Give the date the season closes.';
  } else if (draft.startsOn && draft.endsOn <= draft.startsOn) {
    errors['endsOn'] = 'The season must close after it opens.';
  } else if (draft.startsOn && daysBetween(draft.startsOn, draft.endsOn) > MAX_SEASON_DAYS) {
    errors['endsOn'] = `A season cannot run longer than ${MAX_SEASON_DAYS} days.`;
  }

  // Overlapping windows would let one plot be committed to two seasons at once,
  // and the agreement rule that stops a plot being double-committed works per
  // season — so it would not catch it.
  if (draft.startsOn && draft.endsOn && draft.endsOn > draft.startsOn) {
    const clash = others.find((row) => overlaps(draft, row));
    if (clash) {
      errors['startsOn'] = `${clash.name} already runs ${clash.startsOn} to ${clash.endsOn}.`;
    }
  }

  return errors;
}

/**
 * Reference data that other records point at cannot simply be deleted. Returns
 * the reason it cannot, or an empty string when it can — phrased as a message so
 * the page can say *why* rather than just disabling a button.
 */
export function deletionBlocker(
  season: Season,
  agreements: SharecroppingAgreement[],
  cycles: CultivationCycle[],
): string {
  const usedByAgreements = agreements.filter((row) => row.seasonId === season.id).length;
  if (usedByAgreements) {
    return `${usedByAgreements} agreement${usedByAgreements === 1 ? '' : 's'} run in this season.`;
  }
  const usedByCycles = cycles.filter((row) => row.seasonId === season.id).length;
  if (usedByCycles) {
    return `${usedByCycles} cultivation cycle${usedByCycles === 1 ? '' : 's'} run in this season.`;
  }
  return '';
}

/** The record a draft becomes. Split out so the form does not assemble it. */
export function seasonFromDraft(draft: SeasonDraft, id: string): Season {
  return {
    id,
    name: draft.name.trim(),
    year: draft.year,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn,
    active: draft.active,
  };
}
