import { Tone } from '../../core/models/common';
import { AdvanceStatus } from '../../core/models/cultivation';

/**
 * The status → colour decision, made once for the module so the list, the
 * detail page and the queue cannot disagree about what "pending" looks like.
 *
 * It lives here rather than in `advance-rules.ts` on purpose: this is
 * presentation, and the rules file is meant to stay free of it.
 */
export function advanceTone(status: AdvanceStatus): Tone {
  switch (status) {
    case 'pending':
      // A decision is owed — the same colour the agreement queue uses.
      return 'warn';
    case 'active':
      // Outstanding money is not a success state. It is a live balance the
      // settlement has to clear before it can pay anything out.
      return 'brand';
    case 'repaid':
      return 'ok';
    case 'rejected':
      return 'bad';
    default:
      return 'neutral';
  }
}
