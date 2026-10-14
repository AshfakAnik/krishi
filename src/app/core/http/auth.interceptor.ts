import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SessionService } from '../session';

/**
 * Attaches the JWT to every request against our own backend, and signs out
 * on a 401 — the token expires in 30 minutes (`application.yml`), so
 * without this the app would just fail silently rather than sending the
 * user back to a clean sign-in.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);

  const targetsApi = req.url.startsWith(environment.apiBaseUrl);
  const token = session.token();
  const authedReq = targetsApi && token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    catchError((error: unknown) => {
      if (targetsApi && error instanceof HttpErrorResponse && error.status === 401) {
        session.signOut();
        router.navigate(['/sign-in']);
      }
      return throwError(() => error);
    }),
  );
};
