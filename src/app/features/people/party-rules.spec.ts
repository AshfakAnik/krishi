import { describe, expect, it } from 'vitest';
import { SharecroppingAgreement } from '../../core/models/agreement';
import { Land, Party } from '../../core/models/agriculture';
import { AdvanceLedgerEntry } from '../../core/models/cultivation';
import {
  PartyContext,
  PartyDraft,
  deletionBlocker,
  normalisePhone,
  outstandingFor,
  partyFromDraft,
  roleChangeBlocker,
  validateParty,
} from './party-rules';

const party = (o: Partial<Party> = {}): Party => ({
  id: 'party-owner-1',
  name: 'Ashfakul Alam',
  role: 'owner',
  phone: '01711-204588',
  village: 'Shibpur',
  status: 'active',
  ...o,
});

const draft = (o: Partial<PartyDraft> = {}): PartyDraft => ({
  name: 'Jamal Uddin',
  role: 'sharecropper',
  phone: '01812-334455',
  village: 'Kalikapur',
  seasonsWorked: 4,
  ...o,
});

const context = (o: Partial<PartyContext> = {}): PartyContext => ({
  parties: [party()],
  ...o,
});

const agreement = (o: Partial<SharecroppingAgreement> = {}) =>
  ({
    id: 'agr-1',
    ownerId: 'party-owner-1',
    sharecropperId: 'party-sc-1',
    ...o,
  }) as SharecroppingAgreement;

describe('recording a person', () => {
  it('accepts a complete draft', () => {
    expect(validateParty(draft(), context())).toEqual({});
  });

  it('needs a full name and a village', () => {
    expect(validateParty(draft({ name: 'Ab' }), context())).toHaveProperty('name');
    expect(validateParty(draft({ village: '' }), context())).toHaveProperty('village');
  });

  it('insists on a Bangladeshi mobile number', () => {
    expect(validateParty(draft({ phone: '' }), context())).toHaveProperty('phone');
    expect(validateParty(draft({ phone: '0171-1204588' }), context())).toHaveProperty('phone');
    expect(validateParty(draft({ phone: '9811-234567' }), context())).toHaveProperty('phone');
    expect(validateParty(draft({ phone: '01812334455' }), context())).toEqual({});
  });

  it('catches a duplicate number even when one side is hyphenated', () => {
    // The number is how somebody is reached about their own agreement.
    expect(validateParty(draft({ phone: '01711204588' }), context())).toHaveProperty('phone');
    expect(normalisePhone('01711-204588')).toBe(normalisePhone('01711204588'));
  });

  it('does not clash with itself while being edited', () => {
    expect(
      validateParty(draft({ phone: '01711-204588' }), context({ ignorePartyId: 'party-owner-1' })),
    ).toEqual({});
  });

  it('keeps seasons worked plausible, and only for sharecroppers', () => {
    expect(validateParty(draft({ seasonsWorked: -1 }), context())).toHaveProperty('seasonsWorked');
    expect(validateParty(draft({ seasonsWorked: 200 }), context())).toHaveProperty('seasonsWorked');
    // An owner carries no season count, so an absurd one is not their problem.
    expect(
      validateParty(draft({ role: 'owner', seasonsWorked: 200 }), context()),
    ).not.toHaveProperty('seasonsWorked');
  });

  it('writes seasons worked only onto a sharecropper', () => {
    expect(partyFromDraft(draft({ role: 'sharecropper' }), 'p1').seasonsWorked).toBe(4);
    // A 0 on an owner would render as a meaningful zero rather than as blank.
    expect(partyFromDraft(draft({ role: 'owner' }), 'p1').seasonsWorked).toBeUndefined();
  });
});

describe('changing a role', () => {
  const land = { id: 'land-1', ownerId: 'party-owner-1' } as Land;

  it('is free when nothing points at the old role', () => {
    expect(roleChangeBlocker(party(), 'admin', [], [])).toBe('');
  });

  it('is a no-op when the role has not changed', () => {
    expect(roleChangeBlocker(party(), 'owner', [land], [agreement()])).toBe('');
  });

  it('is blocked for an owner who holds plots or is named on an agreement', () => {
    expect(roleChangeBlocker(party(), 'admin', [land], [])).toContain('1 plot');
    expect(roleChangeBlocker(party(), 'admin', [], [agreement()])).toContain('1 agreement');
  });

  it('is blocked for a sharecropper named on an agreement', () => {
    const tenant = party({ id: 'party-sc-1', role: 'sharecropper' });
    expect(roleChangeBlocker(tenant, 'owner', [], [agreement()])).toContain('sharecropper');
  });
});

describe('removing a person', () => {
  const land = { id: 'land-1', ownerId: 'party-owner-1' } as Land;
  const advance = { id: 'adv-1', sharecropperId: 'party-sc-1' } as AdvanceLedgerEntry;

  it('is allowed when nothing points at them', () => {
    expect(deletionBlocker(party(), [], [], [])).toBe('');
  });

  it('is blocked by plots, agreements or dadhon', () => {
    expect(deletionBlocker(party(), [land], [], [])).toContain('1 plot');
    expect(deletionBlocker(party(), [], [agreement()], [])).toContain('1 agreement');
    expect(deletionBlocker(party({ id: 'party-sc-1' }), [], [], [advance])).toContain(
      '1 dadhon ledger row',
    );
  });
});

describe('what a sharecropper owes', () => {
  const row = (o: Partial<AdvanceLedgerEntry>) =>
    ({
      sharecropperId: 'party-sc-1',
      status: 'active',
      outstanding: 0,
      ...o,
    }) as AdvanceLedgerEntry;

  it('adds up only what was disbursed and is still outstanding', () => {
    const ledger = [
      row({ id: 'a', outstanding: 5000 }),
      row({ id: 'b', outstanding: 2000 }),
      row({ id: 'c', status: 'pending', outstanding: 0 }),
      row({ id: 'd', status: 'repaid', outstanding: 0 }),
      row({ id: 'e', sharecropperId: 'party-sc-2', outstanding: 9000 }),
    ];
    expect(outstandingFor(party({ id: 'party-sc-1' }), ledger)).toBe(7000);
  });
});
