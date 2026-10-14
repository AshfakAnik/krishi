import { Id, PartyStatus, RoleName } from './common';

/**
 * Land type gates which crops may be planted (Lane 1 of the activity diagram):
 * `dhani` is low-lying paddy land, `vita` is raised homestead land. A crop
 * declares which types it tolerates; the agreement rules enforce it.
 */
export type LandType = 'dhani' | 'vita';

export const LAND_TYPE_LABELS: Record<LandType, string> = {
  dhani: 'Paddy Land (Dhani)',
  vita: 'Homestead Land (Vita)',
};

export type FarmingType = 'owner' | 'sharecropping';

export const FARMING_TYPE_LABELS: Record<FarmingType, string> = {
  owner: 'Owner Farming',
  sharecropping: 'Sharecropping',
};

/**
 * Two sharecropping models, and they settle differently:
 *
 * - `normal` — costs and produce are split by negotiated percentages.
 * - `tevaga` — the sharecropper bears the whole cultivation cost and the owner
 *   takes exactly one share out of N (traditionally one of three, hence the
 *   name), in crop or in its cash equivalent.
 */
export type SharecroppingModel = 'normal' | 'tevaga';

export const MODEL_LABELS: Record<SharecroppingModel, string> = {
  normal: 'Normal Sharecropping',
  tevaga: 'Tevaga Sharecropping',
};

/** How the owner takes their share at settlement. */
export type SettlementMode = 'crop' | 'cash';

export const SETTLEMENT_MODE_LABELS: Record<SettlementMode, string> = {
  crop: 'Crop share',
  cash: 'Equivalent cash',
};

export interface Season {
  id: Id;
  name: string;
  year: number;
  /** Inclusive window a cultivation cycle must start inside. */
  startsOn: string;
  endsOn: string;
  active: boolean;
}

export interface Land {
  id: Id;
  code: string;
  name: string;
  landType: LandType;
  /** Decimals. See `formatArea`. */
  area: number;
  location: string;
  ownerId: Id;
  /** Set while an agreement or an owner-farming cycle holds the plot for a
   *  season. Cleared when that agreement is revoked or the cycle closes. */
  heldByAgreementId: Id | null;
}

export interface Crop {
  id: Id;
  name: string;
  /** Lane 1: "Crop Suitable for Land Type?" — the gate lives in the data. */
  suitableLandTypes: LandType[];
}

export interface CropVariety {
  id: Id;
  cropId: Id;
  name: string;
  durationDays: number;
  /** Maund per decimal, used to preview an expected yield. */
  expectedYieldPerDecimal: number;
}

/** Owners, sharecroppers and staff share one table — the diagram treats them
 *  as parties to an agreement, not as three unrelated directories. */
export interface Party {
  id: Id;
  name: string;
  role: RoleName;
  phone: string;
  village: string;
  /** Sharecroppers only: how many seasons they have worked with this owner. */
  seasonsWorked?: number;
  email?: string;
  /** PENDING self-service Owner/Sharecropper signups wait here until an
   *  Admin approves or rejects them; every party an Admin creates directly
   *  is 'active' from the start. */
  status: PartyStatus;
}
