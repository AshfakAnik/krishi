import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { routes } from './app.routes';
import { API } from './core/api-service';
import { authInterceptor } from './core/http/auth.interceptor';
import { HttpApiService } from './core/http/http-api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      // Load-bearing: without it a route param never reaches
      // `input.required<string>()` and the detail page renders empty forever.
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    // HttpApiService itself decides, per collection, whether to hit the
    // real backend or fall back to MockApiService — see its own comment.
    // useExisting, not useClass: components now also inject HttpApiService
    // directly (for `.action()`, not part of the generic ApiService
    // interface) — useClass would construct a second, separate instance.
    { provide: API, useExisting: HttpApiService },
    // Empty at the root: every module registers its own slices with its routes,
    // so the state tree grows only as far as the user navigates.
    provideStore({}),
    provideEffects(),
    // connectInZone: false matters under --zoneless.
    provideStoreDevtools({ maxAge: 50, logOnly: !isDevMode(), connectInZone: false }),
  ],
};
