import {
  AgreementDraft,
  AgreementTerms,
  SharecroppingAgreement,
} from '../../core/models/agreement';
import { Crop, CropVariety, Land, Season } from '../../core/models/agriculture';
import { AdvanceLedgerEntry, CultivationCycle } from '../../core/models/cultivation';
import { ADVANCE_PER_DECIMAL, advanceCeiling } from '../../core/rules/dadhon';

/**
 * Every rule of the Sharecropping Agreement module, as plain functions over
 * plain data. No `inject`, no signals, no store, no Angular import anywhere in
 * this file.
 *
 * That is what lets the whole rule set be tested in milliseconds without a
 * TestBed, and it is why the three components are close to pure markup. When a
 * rule needs a fact, the fact arrives through `context` — a rules file that
 * reaches into the store is no longer testable in isolation, which defeats the
 * point of having one.
 */

/** Lane 2 forbids more than this; local practice is one share of three. */
export const MIN_TEVAGA_SHARES = 3;
export const MAX_TEVAGA_SHARES = 5;

/** An owner's share of the harvest outside this band is not sharecropping. */
export const MIN_OWNER_SHARE = 20;
export const MAX_OWNER_SHARE = 80;

// The dadhon ceiling is shared with Advances & Loans, which caps every
// mid-season draw against the same limit. Re-exported so this module's callers
// still have one place to import its rules from.
export { ADVANCE_PER_DECIMAL, advanceCeiling };

export interface AgreementContext {
  lands: Land[];
  crops: Crop[];
  varieties: CropVariety[];
  seasons: Season[];
  /** Every agreement, so the land-already-committed rule can see them. */
  agreements: SharecroppingAgreement[];
  /** Set when editing, so an agreement does not collide with itself. */
  ignoreAgreementId?: string;
}

/** Agreements that hold a plot. A rejected or revoked one does not. */
export const HOLDING_STATUSES = ['pending', 'active'] as const;

/** Lane 1's "Crop Suitable for Land Type?" gate. */
export function isCropSuitable(crop: Crop | undefined, land: Land | undefined): boolean {
  if (!crop || !land) {
    return false;
  }
  return crop.suitableLandTypes.includes(land.landType);
}

/** Expected harvest in maund, from plot area and the variety's yield. */
export function expectedYield(land: Land | undefined, variety: CropVariety | undefined): number {
  if (!land || !variety) {
    return 0;
  }
  return Math.round(land.area * variety.expectedYieldPerDecimal);
}

/**
 * Preview of who gets what, in maund, before anything is committed. The detail
 * page shows this beside the decision so an approver sees the consequence.
 */
export function shareSplit(
  terms: AgreementTerms,
  yieldMaund: number,
): { owner: number; sharecropper: number } {
  if (terms.model === 'tevaga') {
    // The owner takes exactly one share of N; the sharecropper takes the rest,
    // having borne the whole cultivation cost.
    const shares = Math.max(terms.tevagaTotalShares, 1);
    const owner = Math.round((yieldMaund / shares) * 10) / 10;
    return { owner, sharecropper: Math.round((yieldMaund - owner) * 10) / 10 };
  }
  const owner = Math.round(((yieldMaund * terms.ownerHarvestShare) / 100) * 10) / 10;
  return { owner, sharecropper: Math.round((yieldMaund - owner) * 10) / 10 };
}

/**
 * Returns errors keyed by field name. An empty object means valid.
 *
 * Keyed by field rather than as a list so the form can put each message under
 * the control it belongs to instead of piling them at the top.
 */
export function validateAgreement(
  draft: AgreementDraft,
  context: AgreementContext,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const land = context.lands.find((row) => row.id === draft.landId);
  const crop = context.crops.find((row) => row.id === draft.cropId);
  const variety = context.varieties.find((row) => row.id === draft.varietyId);
  const season = context.seasons.find((row) => row.id === draft.seasonId);

  if (!draft.landId) {
    errors['landId'] = 'Select the plot this agreement covers.';
  }
  if (!draft.sharecropperId) {
    errors['sharecropperId'] = 'Select the sharecropper.';
  }
  if (!draft.seasonId) {
    errors['seasonId'] = 'Select the season.';
  }

  if (land && crop && !isCropSuitable(crop, land)) {
    errors['cropId'] =
      `${crop.name} cannot be grown on ${land.landType === 'dhani' ? 'paddy land (Dhani)' : 'homestead land (Vita)'}.`;
  }

  if (variety && draft.cropId && variety.cropId !== draft.cropId) {
    errors['varietyId'] = 'This variety belongs to a different crop.';
  } else if (!draft.varietyId) {
    errors['varietyId'] = 'Select the crop variety.';
  }

  // The land must not already be committed for the same season by another
  // agreement that still holds it.
  if (land && draft.seasonId) {
    const clash = context.agreements.find(
      (row) =>
        row.id !== context.ignoreAgreementId &&
        row.landId === draft.landId &&
        row.seasonId === draft.seasonId &&
        (HOLDING_STATUSES as readonly string[]).includes(row.status),
    );
    if (clash) {
      errors['landId'] =
        `${land.name} is already committed for this season by ${clash.reference} (${clash.status}).`;
    }
  }

  if (season && draft.startsOn) {
    if (draft.startsOn < season.startsOn || draft.startsOn > season.endsOn) {
      errors['startsOn'] =
        `${season.name} runs ${season.startsOn} to ${season.endsOn}; the start date must fall inside it.`;
    }
  } else if (!draft.startsOn) {
    errors['startsOn'] = 'Give the cultivation start date.';
  }

  Object.assign(errors, validateTerms(draft.terms));

  if (draft.advanceAmount < 0) {
    errors['advanceAmount'] = 'An advance cannot be negative.';
  } else if (land && draft.advanceAmount > advanceCeiling(land)) {
    errors['advanceAmount'] =
      `৳ ${advanceCeiling(land).toLocaleString('en-IN')} is the ceiling for ${land.area} decimal at ৳ ${ADVANCE_PER_DECIMAL} per decimal.`;
  }

  return errors;
}

/** Split out because the model gate is the part most likely to grow. */
export function validateTerms(terms: AgreementTerms): Record<string, string> {
  const errors: Record<string, string> = {};

  if (terms.model === 'normal') {
    if (terms.ownerHarvestShare < MIN_OWNER_SHARE || terms.ownerHarvestShare > MAX_OWNER_SHARE) {
      errors['ownerHarvestShare'] =
        `The owner's share must be between ${MIN_OWNER_SHARE}% and ${MAX_OWNER_SHARE}%.`;
    }
  } else {
    if (
      terms.tevagaTotalShares < MIN_TEVAGA_SHARES ||
      terms.tevagaTotalShares > MAX_TEVAGA_SHARES
    ) {
      errors['tevagaTotalShares'] =
        `Tevaga gives the owner one share of ${MIN_TEVAGA_SHARES} to ${MAX_TEVAGA_SHARES}; a half share is not Tevaga.`;
    }
    // Under Tevaga the sharecropper bears the whole cultivation cost. Recording
    // anything else here would contradict the settlement maths in Lane 5.
    const misassigned = (
      [
        ['costResponsibility', terms.costResponsibility],
        ['labourResponsibility', terms.labourResponsibility],
        ['machineryResponsibility', terms.machineryResponsibility],
        ['inputResponsibility', terms.inputResponsibility],
      ] as const
    ).filter(([, value]) => value !== 'sharecropper');
    if (misassigned.length) {
      errors[misassigned[0][0]] =
        'Under Tevaga the sharecropper bears the entire cultivation cost.';
    }
  }

  return errors;
}

/** Only a pending agreement is decidable. Guards the detail page's buttons and
 *  is asserted again before dispatching, so a stale tab cannot decide twice. */
export function canDecide(agreement: SharecroppingAgreement): boolean {
  return agreement.status === 'pending';
}

/** A rejection or a revocation without a reason is not a decision. */
export function decisionNoteError(note: string): string {
  return note.trim().length < 10 ? 'Give a reason of at least 10 characters.' : '';
}

/**
 * The activation half of the decision: the plot is claimed.
 *
 * Returned as a new object rather than mutated — the store holds these, and a
 * mutation would bypass it.
 */
export function claimLand(land: Land, agreementId: string): Land {
  return { ...land, heldByAgreementId: agreementId };
}

/**
 * The inverse. Revoking an agreement must release exactly the plot it claimed
 * and no other, or a revoke on a re-let plot frees somebody else's land.
 */
export function releaseLand(land: Land, agreementId: string): Land {
  return land.heldByAgreementId === agreementId ? { ...land, heldByAgreementId: null } : land;
}

/** The cultivation cycle an activation creates — the link into Lane 3.
 *  Activating without one leaves the season with nowhere to happen. */
export function cycleForAgreement(
  agreement: SharecroppingAgreement,
  land: Land,
  variety: CropVariety,
  ids: { id: string; reference: string },
): CultivationCycle {
  return {
    id: ids.id,
    reference: ids.reference,
    landId: agreement.landId,
    seasonId: agreement.seasonId,
    cropId: agreement.cropId,
    varietyId: agreement.varietyId,
    farmingType: 'sharecropping',
    agreementId: agreement.id,
    sharecropperId: agreement.sharecropperId,
    startedOn: agreement.startsOn,
    status: 'planned',
    expectedYield: expectedYield(land, variety),
  };
}

/**
 * The dadhon ledger row an activation opens, or null when no advance was
 * agreed. Lane 5 deducts against `outstanding` at settlement.
 *
 * Born `active`, not `pending`: approving the agreement already decided this
 * money. Sending it back through the Advances queue would let the same approver
 * activate an agreement and then refuse the advance it promised.
 */
export function advanceForAgreement(
  agreement: SharecroppingAgreement,
  ids: { id: string; reference: string },
): AdvanceLedgerEntry | null {
  if (agreement.advanceAmount <= 0) {
    return null;
  }
  return {
    id: ids.id,
    reference: ids.reference,
    agreementId: agreement.id,
    sharecropperId: agreement.sharecropperId,
    kind: 'signing',
    amount: agreement.advanceAmount,
    outstanding: agreement.advanceAmount,
    issuedOn: agreement.startsOn,
    note: `Dadhon paid at signing of ${agreement.reference}.`,
    status: 'active',
    requestedBy: agreement.submittedBy,
    requestedOn: agreement.submittedOn,
    decidedBy: agreement.decidedBy,
    decidedOn: agreement.decidedOn,
    decisionNote: '',
  };
}

/** `BRG-2025-007` — next in sequence for the year, from what already exists. */
export function nextReference(agreements: SharecroppingAgreement[], year: number): string {
  const prefix = `BRG-${year}-`;
  const highest = agreements
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
