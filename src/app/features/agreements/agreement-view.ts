import { AgreementStatus } from '../../core/models/agreement';
import { Tone } from '../../core/models/common';

/**
 * The status → colour decision, made once for the module so the list, the
 * detail page and the queue cannot disagree about what "pending" looks like.
 *
 * It lives here rather than in `agreement-rules.ts` on purpose: this is
 * presentation, and the rules file is meant to stay free of it.
 */
export function agreementTone(status: AgreementStatus): Tone {
  switch (status) {
    case 'active':
      return 'ok';
    case 'pending':
      return 'warn';
    case 'rejected':
    case 'revoked':
      return 'bad';
    default:
      return 'neutral';
  }
}
