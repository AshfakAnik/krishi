import { SharecroppingAgreement } from '../../core/models/agreement';
import { Crop, CropVariety, Land, LandType } from '../../core/models/agriculture';
import { CultivationCycle } from '../../core/models/cultivation';

/**
 * Every rule of the Crops & Varieties module, as plain functions over plain
 * data. No `inject`, no signals, no store, no Angular import.
 *
 * This module owns the data behind Lane 1's "Crop Suitable for Land Type?"
 * gate. The agreement rules read `suitableLandTypes` and `expectedYieldPerDecimal`
 * but never write them, so everything that keeps those two fields honest is
 * here.
 */

/** Nothing local ripens faster than a leafy vegetable, or slower than sugarcane. */
export const MIN_DURATION_DAYS = 30;
export const MAX_DURATION_DAYS = 400;

/** Maund per decimal. Potato at 1.8 is the heaviest thing grown here; 5 leaves
 *  room for a crop nobody has recorded yet without admitting a typo. */
export const MAX_YIELD_PER_DECIMAL = 5;

export interface CropDraft {
  name: string;
  suitableLandTypes: LandType[];
}

export interface VarietyDraft {
  cropId: string;
  name: string;
  durationDays: number;
  expectedYieldPerDecimal: number;
}

export interface CropContext {
  crops: Crop[];
  ignoreCropId?: string;
}

export interface VarietyContext {
  varieties: CropVariety[];
  crops: Crop[];
  ignoreVarietyId?: string;
}

export function validateCrop(draft: CropDraft, context: CropContext): Record<string, string> {
  const errors: Record<string, string> = {};
  const others = context.crops.filter((row) => row.id !== context.ignoreCropId);

  if (draft.name.trim().length < 2) {
    errors['name'] = 'Give the crop a name.';
  } else if (
    others.some((row) => row.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
  ) {
    errors['name'] = `${draft.name.trim()} is already recorded.`;
  }

  // A crop that suits no land type can never be selected: the agreement form
  // would offer it and the suitability rule would reject every choice.
  if (!draft.suitableLandTypes.length) {
    errors['suitableLandTypes'] = 'Choose at least one land type, or the crop can never be grown.';
  }

  return errors;
}

export function validateVariety(
  draft: VarietyDraft,
  context: VarietyContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const others = context.varieties.filter((row) => row.id !== context.ignoreVarietyId);

  if (!draft.cropId) {
    errors['cropId'] = 'Select the crop this variety belongs to.';
  } else if (!context.crops.some((row) => row.id === draft.cropId)) {
    errors['cropId'] = 'That crop no longer exists.';
  }

  if (draft.name.trim().length < 2) {
    errors['name'] = 'Give the variety a name, such as BRRI dhan49.';
  } else if (
    others.some(
      (row) =>
        row.cropId === draft.cropId &&
        row.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
    )
  ) {
    errors['name'] = `${draft.name.trim()} is already a variety of this crop.`;
  }

  if (!draft.durationDays) {
    errors['durationDays'] = 'Give the days from sowing to harvest.';
  } else if (draft.durationDays < MIN_DURATION_DAYS || draft.durationDays > MAX_DURATION_DAYS) {
    errors['durationDays'] =
      `A cycle runs between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS} days.`;
  }

  if (!draft.expectedYieldPerDecimal || draft.expectedYieldPerDecimal <= 0) {
    errors['expectedYieldPerDecimal'] = 'Give the expected yield in maund per decimal.';
  } else if (draft.expectedYieldPerDecimal > MAX_YIELD_PER_DECIMAL) {
    // The yield drives every harvest and settlement figure downstream, so a
    // misplaced decimal point here is expensive and invisible.
    errors['expectedYieldPerDecimal'] =
      `${MAX_YIELD_PER_DECIMAL} maund per decimal is the highest this records — check the figure.`;
  }

  return errors;
}

/** What a plot of this size would be expected to give — the same arithmetic the
 *  agreement preview uses, exposed here so the form can show it live. */
export function yieldFor(variety: VarietyDraft | CropVariety, areaDecimals: number): number {
  return Math.round(areaDecimals * variety.expectedYieldPerDecimal);
}

/** Plots this crop could be grown on — the suitability gate, read from the crop
 *  side rather than the plot side. */
export function growableOn(draft: CropDraft | Crop, lands: Land[]): Land[] {
  return lands.filter((land) => draft.suitableLandTypes.includes(land.landType));
}

export function cropDeletionBlocker(
  crop: Crop,
  varieties: CropVariety[],
  agreements: SharecroppingAgreement[],
  cycles: CultivationCycle[],
): string {
  const varietyCount = varieties.filter((row) => row.cropId === crop.id).length;
  if (varietyCount) {
    return `${varietyCount} variet${varietyCount === 1 ? 'y belongs' : 'ies belong'} to it.`;
  }
  const agreementCount = agreements.filter((row) => row.cropId === crop.id).length;
  if (agreementCount) {
    return `${agreementCount} agreement${agreementCount === 1 ? '' : 's'} name this crop.`;
  }
  const cycleCount = cycles.filter((row) => row.cropId === crop.id).length;
  if (cycleCount) {
    return `${cycleCount} cultivation cycle${cycleCount === 1 ? '' : 's'} grew it.`;
  }
  return '';
}

export function varietyDeletionBlocker(
  variety: CropVariety,
  agreements: SharecroppingAgreement[],
  cycles: CultivationCycle[],
): string {
  const agreementCount = agreements.filter((row) => row.varietyId === variety.id).length;
  if (agreementCount) {
    return `${agreementCount} agreement${agreementCount === 1 ? '' : 's'} name this variety.`;
  }
  const cycleCount = cycles.filter((row) => row.varietyId === variety.id).length;
  if (cycleCount) {
    return `${cycleCount} cultivation cycle${cycleCount === 1 ? '' : 's'} grew it.`;
  }
  return '';
}

export function cropFromDraft(draft: CropDraft, id: string): Crop {
  return { id, name: draft.name.trim(), suitableLandTypes: [...draft.suitableLandTypes] };
}

export function varietyFromDraft(draft: VarietyDraft, id: string): CropVariety {
  return {
    id,
    cropId: draft.cropId,
    name: draft.name.trim(),
    durationDays: draft.durationDays,
    expectedYieldPerDecimal: draft.expectedYieldPerDecimal,
  };
}
