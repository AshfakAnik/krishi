import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Land } from '../models/agriculture';
import { SharecroppingAgreement } from '../models/agreement';
import { AdvanceLedgerEntry, CultivationCycle } from '../models/cultivation';
import { SessionService } from '../session';
import { MOCK_DB } from '../mock-db/mock-db';
import { OfflineApiService } from './offline-api';

describe('OfflineApiService (in-memory fallback, same code path as SQLite)', () => {
  let api: OfflineApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    api = TestBed.inject(OfflineApiService);
  });

  it('serves the seeded dummy data', async () => {
    const parties = await firstValueFrom(api.list('parties'));
    expect(parties.length).toBe(MOCK_DB.parties.length);
  });

  it('creates, updates and removes a row', async () => {
    const crop = { id: 'crop-test', name: 'Test crop', suitableLandTypes: ['dhani'] };
    await firstValueFrom(api.create('crops', crop));
    await firstValueFrom(api.update('crops', { ...crop, name: 'Renamed' }));
    expect((await firstValueFrom(api.get<typeof crop>('crops', 'crop-test'))).name).toBe('Renamed');
    await firstValueFrom(api.remove('crops', 'crop-test'));
    await expect(firstValueFrom(api.get('crops', 'crop-test'))).rejects.toThrow('not found');
  });

  it('approving an agreement claims the plot, opens a cycle and disburses the advance', async () => {
    const all = await firstValueFrom(api.list<SharecroppingAgreement>('agreements'));
    const pending = all.find((row) => row.status === 'pending')!;
    const cyclesBefore = (await firstValueFrom(api.list('cultivationCycles'))).length;

    const approved = await firstValueFrom(api.action<SharecroppingAgreement>('agreements', pending.id, 'approve'));

    expect(approved.status).toBe('active');
    expect(approved.cultivationCycleId).toBeTruthy();
    const land = await firstValueFrom(api.get<Land>('lands', pending.landId));
    expect(land.heldByAgreementId).toBe(pending.id);
    const cycles = await firstValueFrom(api.list<CultivationCycle>('cultivationCycles'));
    expect(cycles.length).toBe(cyclesBefore + 1);
    if (pending.advanceAmount > 0) {
      const ledger = await firstValueFrom(api.list<AdvanceLedgerEntry>('advances'));
      expect(ledger.some((e) => e.agreementId === pending.id && e.kind === 'signing')).toBe(true);
    }
  });

  it('refuses to decide an agreement twice', async () => {
    const all = await firstValueFrom(api.list<SharecroppingAgreement>('agreements'));
    const pending = all.find((row) => row.status === 'pending')!;
    await firstValueFrom(api.action('agreements', pending.id, 'approve'));
    await expect(firstValueFrom(api.action('agreements', pending.id, 'approve'))).rejects.toThrow('pending');
  });

  it('signs in by first name without a server', async () => {
    const session = TestBed.inject(SessionService);
    const response = await firstValueFrom(session.login('rezaul', ''));
    expect(response.role).toBe('ADMIN');
    expect(session.role()).toBe('admin');
    session.signOut();
  });
});
