import { SharecroppingAgreement } from '../../core/models/agreement';
import { Land, LandType } from '../../core/models/agriculture';
import { Crop } from '../../core/models/agriculture';
import { CultivationCycle } from '../../core/models/cultivation';

/**
 * Every rule of the Lands module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import.
 *
 * Land is the record the rest of the system points at hardest: an agreement
 * commits a plot, a cycle happens on one, and the dadhon ceiling is a function
 * of its area. So most of what is here protects those references from an edit
 * made long after the fact.
 */

/** A plot smaller than this is a homestead corner, not a cultivable plot. */
export const MIN_AREA_DECIMALS = 1;
/** 100 decimal is an acre; a single dag over 50 acres is a data-entry slip. */
export const MAX_AREA_DECIMALS = 5000;

export interface LandDraft {
  code: string;
  name: string;
  landType: LandType;
  area: number;
  location: string;
  ownerId: string;
}

export interface LandContext {
  lands: Land[];
  /** Set when editing, so a plot does not clash with itself. */
  ignoreLandId?: string;
}

/** Agreements that hold a plot — the same list the agreement rules use. */
const HOLDING_STATUSES = ['pending', 'active'] as const;

export function validateLand(draft: LandDraft, context: LandContext): Record<string, string> {
  const errors: Record<string, string> = {};
  const others = context.lands.filter((row) => row.id !== context.ignoreLandId);

  if (!draft.code.trim()) {
    errors['code'] = 'Give the dag code, such as SHB-DAG-104.';
  } else if (
    others.some((row) => row.code.trim().toLowerCase() === draft.code.trim().toLowerCase())
  ) {
    // The dag code is how a plot is identified on paper. Two rows sharing one is
    // how the wrong plot ends up in an agreement.
    errors['code'] = `${draft.code.trim()} is already the code for another plot.`;
  }

  if (draft.name.trim().length < 2) {
    errors['name'] = 'Give the plot its local name.';
  }

  if (!draft.ownerId) {
    errors['ownerId'] = 'Select the owner of this plot.';
  }

  if (!draft.location.trim()) {
    errors['location'] = 'Give the mouza and dag so the plot can be found.';
  }

  if (!draft.area || draft.area <= 0) {
    errors['area'] = 'Give the area in decimals.';
  } else if (draft.area < MIN_AREA_DECIMALS) {
    errors['area'] = `A plot of less than ${MIN_AREA_DECIMALS} decimal cannot be cultivated.`;
  } else if (draft.area > MAX_AREA_DECIMALS) {
    errors['area'] = `${MAX_AREA_DECIMALS} decimal is the largest single dag this records.`;
  }

  return errors;
}

/** True while an agreement holds the plot for a season. */
export function isHeld(land: Land): boolean {
  return land.heldByAgreementId !== null;
}

/**
 * What an edit may not change while the plot is committed.
 *
 * Area and land type were both validated at signing — the crop had to suit the
 * type, and the advance had to fit a ceiling derived from the area. Changing
 * either afterwards silently invalidates a decision somebody already made.
 */
export function lockedFields(
  land: Land,
  agreements: SharecroppingAgreement[],
): ('landType' | 'area')[] {
  const committed = agreements.some(
    (row) => row.landId === land.id && (HOLDING_STATUSES as readonly string[]).includes(row.status),
  );
  return committed ? ['landType', 'area'] : [];
}

/** Which crops may be grown here — Lane 1's gate, read from the plot's side. */
export function suitableCrops(land: Land | undefined, crops: Crop[]): Crop[] {
  return land ? crops.filter((crop) => crop.suitableLandTypes.includes(land.landType)) : [];
}

/**
 * Reference data other records point at cannot be deleted. Returns the reason,
 * or an empty string — phrased as a message so the page can say *why*.
 */
export function deletionBlocker(
  land: Land,
  agreements: SharecroppingAgreement[],
  cycles: CultivationCycle[],
): string {
  if (isHeld(land)) {
    return 'an agreement currently holds this plot.';
  }
  const agreementCount = agreements.filter((row) => row.landId === land.id).length;
  if (agreementCount) {
    return `${agreementCount} agreement${agreementCount === 1 ? '' : 's'} reference this plot.`;
  }
  const cycleCount = cycles.filter((row) => row.landId === land.id).length;
  if (cycleCount) {
    return `${cycleCount} cultivation cycle${cycleCount === 1 ? '' : 's'} happened on this plot.`;
  }
  return '';
}

export function landFromDraft(
  draft: LandDraft,
  id: string,
  heldByAgreementId: string | null,
): Land {
  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    landType: draft.landType,
    area: draft.area,
    location: draft.location.trim(),
    ownerId: draft.ownerId,
    heldByAgreementId,
  };
}
