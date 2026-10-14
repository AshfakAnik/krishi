import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { MODULES } from './module-registry';
import { SessionService } from './session';
import { RoleName } from './models/common';

/** Not signed in? The whole app is behind this. Lane 1 of the diagram starts at
 *  Login → Authenticated?, and so does the app. */
export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.isSignedIn() ? true : router.createUrlTree(['/sign-in']);
};

/** The sign-in page itself is only reachable while signed out. */
export const guestGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.isSignedIn() ? router.createUrlTree(['/agreements']) : true;
};

/**
 * Enforces the same `roles` list the sidebar filters on, so a module hidden from
 * a role cannot be reached by typing its URL either.
 *
 * The redirect target is the module list, not a "denied" page: the sidebar never
 * renders a link a role cannot follow, so arriving here means someone typed or
 * bookmarked the URL.
 */
export const roleGuard: CanActivateChildFn = (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const role = session.role();
  if (!role) {
    return router.createUrlTree(['/sign-in']);
  }

  const segment = state.url.split('?')[0].split('/').filter(Boolean)[0] ?? '';
  const entry = MODULES.find((module) => module.path === segment);
  // An unregistered path is not this guard's business — let the router 404 it.
  if (!entry) {
    return true;
  }
  return entry.roles.includes(role as RoleName) ? true : router.createUrlTree(['/agreements']);
};
