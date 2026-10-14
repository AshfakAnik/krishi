import { Tone } from '../../core/models/common';

/**
 * The standing → colour decision, made once for the module so the list and the
 * form cannot disagree about what "open" looks like.
 *
 * Presentation, which is why it is here and not in `season-rules.ts`.
 */
export function seasonTone(standing: 'upcoming' | 'open' | 'closed'): Tone {
  switch (standing) {
    case 'open':
      return 'ok';
    case 'upcoming':
      return 'brand';
    default:
      return 'neutral';
  }
}

export const SEASON_STANDING_LABELS: Record<'upcoming' | 'open' | 'closed', string> = {
  upcoming: 'Upcoming',
  open: 'Open',
  closed: 'Closed',
};
