import { Tone } from '../../core/models/common';
import { CycleStatus } from '../../core/models/cultivation';

/**
 * The status → colour decision, made once for the module so the list and the
 * detail page cannot disagree about what "ongoing" looks like.
 *
 * Presentation, which is why it is here and not in `cycle-rules.ts`.
 */
export function cycleTone(status: CycleStatus): Tone {
  switch (status) {
    case 'ongoing':
      return 'brand';
    case 'harvesting':
      return 'warn';
    case 'settled':
      return 'ok';
    case 'aborted':
      return 'bad';
    default:
      return 'neutral';
  }
}
