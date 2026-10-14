import { SharecroppingAgreement } from '../../core/models/agreement';
import { Land, Party } from '../../core/models/agriculture';
import { RoleName } from '../../core/models/common';
import { AdvanceLedgerEntry } from '../../core/models/cultivation';

/**
 * Every rule of the Owners & Sharecroppers module, as plain functions over plain
 * data. No `inject`, no signals, no store, no Angular import.
 *
 * A party is both a directory entry and a login. That is why the role is not
 * merely a label: it decides what the person may do, and every other module
 * points at these ids.
 */

/** Bangladeshi mobile numbers: eleven digits opening 01, optionally hyphenated
 *  after the fifth, as they are written on every agreement form here. */
export const PHONE_PATTERN = /^01\d{3}-?\d{6}$/;

export interface PartyDraft {
  name: string;
  role: RoleName;
  phone: string;
  village: string;
  seasonsWorked: number;
}

export interface PartyContext {
  parties: Party[];
  ignorePartyId?: string;
}

/** Digits only, so `01711-204588` and `01711204588` are the same number. */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function validateParty(draft: PartyDraft, context: PartyContext): Record<string, string> {
  const errors: Record<string, string> = {};
  const others = context.parties.filter((row) => row.id !== context.ignorePartyId);

  if (draft.name.trim().length < 3) {
    errors['name'] = 'Give the person’s full name.';
  }

  if (!draft.phone.trim()) {
    errors['phone'] = 'Give a mobile number.';
  } else if (!PHONE_PATTERN.test(draft.phone.trim())) {
    errors['phone'] = 'A mobile number here is eleven digits opening 01, such as 01711-204588.';
  } else if (
    // Compared on digits, so a hyphen does not hide a duplicate. The number is
    // how somebody is reached about their own agreement.
    others.some((row) => normalisePhone(row.phone) === normalisePhone(draft.phone))
  ) {
    errors['phone'] = 'Another person is already recorded with that number.';
  }

  if (!draft.village.trim()) {
    errors['village'] = 'Give the village, so the person can be found.';
  }

  if (draft.role === 'sharecropper') {
    if (draft.seasonsWorked < 0) {
      errors['seasonsWorked'] = 'Seasons worked cannot be negative.';
    } else if (draft.seasonsWorked > 80) {
      errors['seasonsWorked'] = 'Check the figure — that is a lifetime of seasons.';
    }
  }

  return errors;
}

/**
 * Why a role may not be changed, or an empty string when it may.
 *
 * A role is not a label: an owner's plots and a sharecropper's agreements both
 * hang off it, and the list a page shows for each role is filtered on it. Moving
 * somebody between roles while records point at them in the old one leaves those
 * records unreachable from every page that filters by role.
 */
export function roleChangeBlocker(
  party: Party,
  nextRole: RoleName,
  lands: Land[],
  agreements: SharecroppingAgreement[],
): string {
  if (party.role === nextRole) {
    return '';
  }

  if (party.role === 'owner') {
    const owned = lands.filter((row) => row.ownerId === party.id).length;
    if (owned) {
      return `${owned} plot${owned === 1 ? '' : 's'} are recorded under this owner.`;
    }
    const asOwner = agreements.filter((row) => row.ownerId === party.id).length;
    if (asOwner) {
      return `${asOwner} agreement${asOwner === 1 ? '' : 's'} name this person as the owner.`;
    }
  }

  if (party.role === 'sharecropper') {
    const asTenant = agreements.filter((row) => row.sharecropperId === party.id).length;
    if (asTenant) {
      return `${asTenant} agreement${asTenant === 1 ? '' : 's'} name this person as the sharecropper.`;
    }
  }

  return '';
}

export function deletionBlocker(
  party: Party,
  lands: Land[],
  agreements: SharecroppingAgreement[],
  ledger: AdvanceLedgerEntry[],
): string {
  const owned = lands.filter((row) => row.ownerId === party.id).length;
  if (owned) {
    return `${owned} plot${owned === 1 ? '' : 's'} are recorded under this person.`;
  }
  const named = agreements.filter(
    (row) => row.ownerId === party.id || row.sharecropperId === party.id,
  ).length;
  if (named) {
    return `${named} agreement${named === 1 ? '' : 's'} name this person.`;
  }
  const dadhon = ledger.filter((row) => row.sharecropperId === party.id).length;
  if (dadhon) {
    return `${dadhon} dadhon ledger row${dadhon === 1 ? '' : 's'} belong to this person.`;
  }
  return '';
}

/** What a sharecropper still owes across every agreement — the figure an owner
 *  actually wants when looking somebody up. */
export function outstandingFor(party: Party, ledger: AdvanceLedgerEntry[]): number {
  return ledger
    .filter((row) => row.sharecropperId === party.id && row.status === 'active')
    .reduce((total, row) => total + row.outstanding, 0);
}

export function partyFromDraft(draft: PartyDraft, id: string): Party {
  const party: Party = {
    id,
    name: draft.name.trim(),
    role: draft.role,
    phone: draft.phone.trim(),
    village: draft.village.trim(),
    // A party created or edited directly here is implicitly approved —
    // matches PartyController.create() setting ACTIVE server-side. On an
    // edit this value is discarded (PartyController.update() never touches
    // status), so it only ever takes effect on create.
    status: 'active',
  };
  // Only sharecroppers carry it; writing 0 onto an owner would render as a
  // meaningful zero rather than as "not applicable".
  return draft.role === 'sharecropper' ? { ...party, seasonsWorked: draft.seasonsWorked } : party;
}
