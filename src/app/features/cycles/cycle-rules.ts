import { SharecroppingAgreement } from '../../core/models/agreement';
import { Crop, CropVariety, Land, Season } from '../../core/models/agriculture';
import { CultivationCycle, CycleStatus } from '../../core/models/cultivation';

/**
 * Every rule of the Cultivation Cycles module, as plain functions over plain
 * data. No `inject`, no signals, no store, no Angular import.
 *
 * A cycle is where Lane 3 happens: every activity, every monitoring log and
 * every harvest hangs off one. Two things can open a cycle — approving a
 * sharecropping agreement, which the Agreements module already does, and an
 * owner deciding to farm a plot themselves, which is the branch of Lane 2 this
 * module owns.
 */

/** The lifecycle, in order. A cycle only ever moves forward along it. */
export const CYCLE_PROGRESSION: CycleStatus[] = ['planned', 'ongoing', 'harvesting', 'settled'];

/** Statuses in which the cycle still holds its plot. A settled or aborted cycle
 *  has released it — the same exemption `HOLDING_STATUSES` makes for an
 *  agreement. */
export const OCCUPYING_STATUSES = ['planned', 'ongoing', 'harvesting'] as const;

export interface CycleDraft {
  landId: string;
  seasonId: string;
  cropId: string;
  varietyId: string;
  startedOn: string;
}

export interface CycleContext {
  lands: Land[];
  crops: Crop[];
  varieties: CropVariety[];
  seasons: Season[];
  cycles: CultivationCycle[];
  agreements: SharecroppingAgreement[];
  /** Set when editing, so a cycle does not clash with itself. */
  ignoreCycleId?: string;
}

/** Expected harvest in maund, from plot area and the variety's yield. The same
 *  arithmetic the agreement preview uses — duplicated deliberately nowhere: both
 *  read it from the variety. */
export function expectedYield(land: Land | undefined, variety: CropVariety | undefined): number {
  if (!land || !variety) {
    return 0;
  }
  return Math.round(land.area * variety.expectedYieldPerDecimal);
}

export function occupies(cycle: CultivationCycle): boolean {
  return (OCCUPYING_STATUSES as readonly string[]).includes(cycle.status);
}

/**
 * Validates an **owner-farming** cycle. A sharecropping cycle is not created
 * here — it is created by approving an agreement, which has already checked all
 * of this.
 */
export function validateCycle(draft: CycleDraft, context: CycleContext): Record<string, string> {
  const errors: Record<string, string> = {};

  const land = context.lands.find((row) => row.id === draft.landId);
  const crop = context.crops.find((row) => row.id === draft.cropId);
  const variety = context.varieties.find((row) => row.id === draft.varietyId);
  const season = context.seasons.find((row) => row.id === draft.seasonId);

  if (!draft.landId) {
    errors['landId'] = 'Select the plot to be farmed.';
  }
  if (!draft.seasonId) {
    errors['seasonId'] = 'Select the season.';
  }

  // The suitability gate again, because an owner farming their own land is as
  // capable of planting paddy on homestead land as anybody else.
  if (land && crop && !crop.suitableLandTypes.includes(land.landType)) {
    errors['cropId'] =
      `${crop.name} cannot be grown on ${land.landType === 'dhani' ? 'paddy land (Dhani)' : 'homestead land (Vita)'}.`;
  } else if (!draft.cropId) {
    errors['cropId'] = 'Select the crop.';
  }

  if (variety && draft.cropId && variety.cropId !== draft.cropId) {
    errors['varietyId'] = 'This variety belongs to a different crop.';
  } else if (!draft.varietyId) {
    errors['varietyId'] = 'Select the crop variety.';
  }

  // A plot can only carry one cycle per season, whoever is farming it — and an
  // agreement holding it for that season blocks an owner-farming cycle too.
  if (land && draft.seasonId) {
    const cycleClash = context.cycles.find(
      (row) =>
        row.id !== context.ignoreCycleId &&
        row.landId === draft.landId &&
        row.seasonId === draft.seasonId &&
        occupies(row),
    );
    if (cycleClash) {
      errors['landId'] = `${land.name} already carries cycle ${cycleClash.reference} this season.`;
    } else {
      const agreementClash = context.agreements.find(
        (row) =>
          row.landId === draft.landId &&
          row.seasonId === draft.seasonId &&
          (row.status === 'pending' || row.status === 'active'),
      );
      if (agreementClash) {
        errors['landId'] =
          `${land.name} is committed to ${agreementClash.reference} for this season.`;
      }
    }
  }

  if (!draft.startedOn) {
    errors['startedOn'] = 'Give the date cultivation starts.';
  } else if (season && (draft.startedOn < season.startsOn || draft.startedOn > season.endsOn)) {
    errors['startedOn'] =
      `${season.name} runs ${season.startsOn} to ${season.endsOn}; the start date must fall inside it.`;
  }

  return errors;
}

/** The owner-farming cycle a valid draft becomes. No agreement, no tenant —
 *  which is exactly what distinguishes this branch of Lane 2. */
export function ownerCycleFromDraft(
  draft: CycleDraft,
  land: Land,
  variety: CropVariety,
  ids: { id: string; reference: string },
): CultivationCycle {
  return {
    id: ids.id,
    reference: ids.reference,
    landId: draft.landId,
    seasonId: draft.seasonId,
    cropId: draft.cropId,
    varietyId: draft.varietyId,
    farmingType: 'owner',
    agreementId: null,
    sharecropperId: null,
    startedOn: draft.startedOn,
    status: 'planned',
    expectedYield: expectedYield(land, variety),
  };
}

/** The status a cycle may move to next, or null at the end of the line. */
export function nextStatus(cycle: CultivationCycle): CycleStatus | null {
  const index = CYCLE_PROGRESSION.indexOf(cycle.status);
  // -1 covers `aborted`, which is not on the progression and cannot resume.
  if (index === -1 || index === CYCLE_PROGRESSION.length - 1) {
    return null;
  }
  return CYCLE_PROGRESSION[index + 1];
}

export function canAdvance(cycle: CultivationCycle): boolean {
  return nextStatus(cycle) !== null;
}

/** Aborting is for a cycle lost to flood, pest or a revoked agreement. A settled
 *  one is finished and must stay that way. */
export function canAbort(cycle: CultivationCycle): boolean {
  return cycle.status !== 'settled' && cycle.status !== 'aborted';
}

export function advance(cycle: CultivationCycle): CultivationCycle {
  const next = nextStatus(cycle);
  return next ? { ...cycle, status: next } : cycle;
}

export function abort(cycle: CultivationCycle): CultivationCycle {
  return canAbort(cycle) ? { ...cycle, status: 'aborted' } : cycle;
}

/**
 * The plot claim, and its inverse.
 *
 * An owner-farming cycle holds its plot through the same field an agreement
 * uses, storing the cycle id — the model documents the field as covering both.
 * Releasing checks the id first, so closing one cycle cannot free a plot some
 * other record has since claimed.
 */
export function claimForCycle(land: Land, cycleId: string): Land {
  return { ...land, heldByAgreementId: cycleId };
}

export function releaseFromCycle(land: Land, cycleId: string): Land {
  return land.heldByAgreementId === cycleId ? { ...land, heldByAgreementId: null } : land;
}

/** `CYC-2025-007` — next in sequence for the year, from what already exists. */
export function nextCycleReference(cycles: CultivationCycle[], year: number): string {
  const prefix = `CYC-${year}-`;
  const highest = cycles
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
