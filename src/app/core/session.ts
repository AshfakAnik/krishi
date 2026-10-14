import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, from, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ROLE_LABELS, RoleName } from './models/common';
import { Party } from './models/agriculture';
import { LocalDb } from './offline/local-db';

const STORAGE_KEY = 'krishi.session';

interface LoginResponse {
  token: string;
  expiresAt: string;
  partyId: string;
  name: string;
  role: string;
}

export interface SignupPayload {
  name: string;
  username: string;
  email: string;
  password: string;
  phone: string;
  village: string;
  role: RoleName;
  adminCode?: string;
}

interface SignupResponse {
  partyId: string;
  status: string;
  message: string;
}

interface MessageResponse {
  message: string;
}

interface StoredSession {
  token: string;
  expiresAt: string;
  partyId: string;
  name: string;
  role: RoleName;
}

/**
 * Who is acting, and what they may do.
 *
 * Templates read **capability** signals (`canApproveAgreement`), never raw role
 * comparisons. When the rule changes — say an owner may approve their own
 * agreements below some size — it changes in one place instead of in every
 * template that happened to write `role() === 'admin'`.
 *
 * Backed by a real login (`POST /auth/login`) rather than the old mock
 * actor-picker. The session — token, expiry, party id, name, role — is kept
 * in `sessionStorage` so a reload doesn't sign you out mid-walkthrough.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly localDb = inject(LocalDb);

  private readonly session = signal<StoredSession | null>(readStoredSession());

  /** Narrower than the old mock's full `Party` — every one of this app's
   *  ~14 `actor()` call sites only ever reads `.id`/`.role` (row-scoping
   *  logic), never `.name`/`.phone`/`.village`, and a real login response
   *  doesn't carry those anyway. */
  readonly actor = computed(() => {
    const current = this.session();
    return current ? { id: current.partyId, role: current.role } : null;
  });

  readonly isSignedIn = computed(() => this.session() !== null);
  readonly actorName = computed(() => this.session()?.name ?? '');
  readonly role = computed<RoleName | null>(() => this.session()?.role ?? null);
  readonly roleLabel = computed(() => {
    const role = this.role();
    return role ? ROLE_LABELS[role] : '';
  });

  /** Read by `authInterceptor`. */
  readonly token = computed(() => this.session()?.token ?? null);

  /** Only an administrator decides on an agreement. An owner submits it; a
   *  sharecropper reads their own. */
  readonly canApproveAgreement = computed(() => this.role() === 'admin');

  /** Owners draft agreements for their own land; the administrator may draft on
   *  anyone's behalf. */
  readonly canDraftAgreement = computed(() => this.role() === 'admin' || this.role() === 'owner');

  /** Same split as an agreement: the owner puts the request in on the tenant's
   *  behalf, the administrator decides it. A sharecropper reads their own. */
  readonly canRequestAdvance = computed(() => this.role() === 'admin' || this.role() === 'owner');

  /** Only an administrator releases dadhon, and only an administrator records
   *  it as repaid — both move money against the settlement Lane 5 will run. */
  readonly canApproveAdvance = computed(() => this.role() === 'admin');

  /** A sharecropper sees only the agreements they are party to. */
  readonly isSelfService = computed(() => this.role() === 'sharecropper');

  login(username: string, password: string): Observable<LoginResponse> {
    const request$ = environment.offline
      ? from(this.offlineLogin(username))
      : this.http.post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, { username, password });
    return request$.pipe(
      tap((response) => {
        const stored: StoredSession = {
          token: response.token,
          expiresAt: response.expiresAt,
          partyId: response.partyId,
          name: response.name,
          // The backend serializes RoleName as its Java enum name ("ADMIN");
          // the frontend's RoleName union is lowercase.
          role: response.role.toLowerCase() as RoleName,
        };
        this.session.set(stored);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      }),
    );
  }

  /** Never sets the session — a PENDING (Owner/Sharecropper) signup can't
   *  sign in yet regardless, and even an auto-activated Admin signup signs
   *  in explicitly through login() rather than being logged in silently
   *  here. */
  signup(payload: SignupPayload): Observable<SignupResponse> {
    if (environment.offline) {
      return from(this.offlineSignup(payload));
    }
    return this.http.post<SignupResponse>(`${environment.apiBaseUrl}/auth/signup`, {
      ...payload,
      // Backend RoleName is a Java enum ("ADMIN"); the frontend's RoleName
      // union is lowercase — same conversion http-api.ts's toWire() does
      // for every other collection's enum fields.
      role: payload.role.toUpperCase(),
    });
  }

  requestPasswordReset(email: string): Observable<MessageResponse> {
    if (environment.offline) {
      return offlineOnly('Password reset needs internet. Offline, sign in with your username.');
    }
    return this.http.post<MessageResponse>(`${environment.apiBaseUrl}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, newPassword: string): Observable<MessageResponse> {
    if (environment.offline) {
      return offlineOnly('Password reset needs internet.');
    }
    return this.http.post<MessageResponse>(`${environment.apiBaseUrl}/auth/reset-password`, {
      token,
      newPassword,
    });
  }

  /** Offline there is no server to check a password against, so the account is
   *  found by username (or first name, or full name) among the parties stored
   *  on this device. Only an approved (active) party may sign in. */
  private async offlineLogin(username: string): Promise<LoginResponse> {
    const wanted = normalize(username);
    const parties = await this.localDb.all<Party & { username?: string }>('parties');
    const party = parties.find((p) =>
      [p.username, p.name, p.name.split(' ')[0], p.email?.split('@')[0]].some((c) => c && normalize(c) === wanted),
    );
    if (!party) {
      throw offlineError(401, 'No account with that username on this device.');
    }
    if (party.status !== 'active') {
      throw offlineError(403, 'This account is waiting for an administrator to approve it.');
    }
    return {
      token: `offline-${party.id}`,
      expiresAt: '2999-12-31T00:00:00Z',
      partyId: party.id,
      name: party.name,
      role: party.role.toUpperCase(),
    };
  }

  private async offlineSignup(payload: SignupPayload): Promise<SignupResponse> {
    const parties = await this.localDb.all<Party & { username?: string }>('parties');
    const taken = parties.some((p) => p.username && normalize(p.username) === normalize(payload.username));
    if (taken) {
      throw offlineError(409, 'That username is already taken on this device.');
    }
    const id = `party-${Date.now().toString(36)}`;
    // An administrator account is only auto-approved when an admin code was typed;
    // the code itself cannot be verified without the server.
    const status = payload.role === 'admin' && payload.adminCode ? 'active' : 'pending';
    const party: Party & { username: string } = {
      id,
      name: payload.name,
      role: payload.role,
      phone: payload.phone,
      village: payload.village,
      email: payload.email,
      username: payload.username,
      status,
    };
    await this.localDb.put('parties', party);
    return {
      partyId: id,
      status: status.toUpperCase(),
      message:
        status === 'active'
          ? 'Account created. You can sign in now.'
          : 'Account created. An administrator must approve it before you can sign in.',
    };
  }

  signOut(): void {
    this.session.set(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

/** An `HttpErrorResponse` on purpose: the sign-in and sign-up screens only read
 *  `error.error.message` off that type. */
function offlineError(status: number, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { message } });
}

function offlineOnly(message: string): Observable<never> {
  return throwError(() => offlineError(503, message));
}

function readStoredSession(): StoredSession | null {
  // Guarded because `sessionStorage` is unavailable in a non-browser test
  // environment, and a throw here would take the whole injector down.
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}
