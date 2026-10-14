import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/access-guard';
import { MODULES } from './core/module-registry';
import { provideCollection } from './core/store/collection-feature';
import {
  advancesFeature,
  agreementsFeature,
  auditLogsFeature,
  calendarTasksFeature,
  cropVarietiesFeature,
  cropsFeature,
  cultivationCyclesFeature,
  disputesFeature,
  financeEntriesFeature,
  farmingActivitiesFeature,
  harvestsFeature,
  landsFeature,
  monitoringLogsFeature,
  processingBatchesFeature,
  salesFeature,
  settlementsFeature,
  stockLotsFeature,
  partiesFeature,
  seasonsFeature,
} from './core/store/features';

/** Every module the registry lists but nobody has built yet gets the stub page,
 *  so navigation is never broken while the app is incomplete. */
const stubRoutes: Routes = MODULES.filter((entry) => !entry.built).map((entry) => ({
  path: entry.path,
  title: entry.label,
  loadComponent: () => import('./features/stub/module-stub').then((m) => m.ModuleStub),
}));

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Krishi — Smart Farming & Sharecropping Management',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/landing/landing-page').then((m) => m.LandingPage),
  },
  {
    path: 'sign-in',
    title: 'Sign in · Krishi',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/sign-in').then((m) => m.SignIn),
  },
  {
    path: 'sign-up',
    title: 'Create account · Krishi',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/sign-up').then((m) => m.SignUp),
  },
  {
    path: 'forgot-password',
    title: 'Forgot password · Krishi',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/forgot-password').then((m) => m.ForgotPassword),
  },
  {
    path: 'reset-password',
    title: 'Reset password · Krishi',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/reset-password').then((m) => m.ResetPassword),
  },
  {
    path: '',
    canActivate: [authGuard],
    // Same roles list the sidebar filters on, so a hidden module is unreachable
    // by URL as well as invisible in the nav.
    canActivateChild: [roleGuard],
    loadComponent: () => import('./layout/app-shell').then((m) => m.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'agreements' },
      {
        path: 'agreements',
        // Providers on the parent: the list and the detail page share one
        // registration, so navigating between them does not refetch.
        providers: [
          ...provideCollection(agreementsFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(cropsFeature),
          ...provideCollection(cropVarietiesFeature),
          ...provideCollection(partiesFeature),
          ...provideCollection(seasonsFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(advancesFeature),
        ],
        children: [
          {
            path: '',
            title: 'Sharecropping Agreements · Krishi',
            loadComponent: () =>
              import('./features/agreements/agreement-list').then((m) => m.AgreementList),
          },
          {
            path: ':id',
            title: 'Agreement · Krishi',
            loadComponent: () =>
              import('./features/agreements/agreement-detail').then((m) => m.AgreementDetail),
          },
        ],
      },
      {
        path: 'seasons',
        title: 'Seasons · Krishi',
        // Reference data: the edit form is the detail, so there is no child
        // route to share providers with.
        providers: [
          ...provideCollection(seasonsFeature),
          ...provideCollection(agreementsFeature),
          ...provideCollection(cultivationCyclesFeature),
        ],
        loadComponent: () => import('./features/seasons/season-list').then((m) => m.SeasonList),
      },
      {
        path: 'lands',
        providers: [
          ...provideCollection(landsFeature),
          ...provideCollection(agreementsFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(partiesFeature),
          ...provideCollection(seasonsFeature),
          ...provideCollection(cropsFeature),
          ...provideCollection(advancesFeature),
        ],
        children: [
          {
            path: '',
            title: 'Lands · Krishi',
            loadComponent: () => import('./features/lands/land-list').then((m) => m.LandList),
          },
          {
            path: ':id',
            title: 'Plot · Krishi',
            loadComponent: () => import('./features/lands/land-detail').then((m) => m.LandDetail),
          },
        ],
      },
      {
        path: 'crops',
        providers: [
          ...provideCollection(cropsFeature),
          ...provideCollection(cropVarietiesFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(agreementsFeature),
          ...provideCollection(cultivationCyclesFeature),
        ],
        children: [
          {
            path: '',
            title: 'Crops & Varieties · Krishi',
            loadComponent: () => import('./features/crops/crop-list').then((m) => m.CropList),
          },
          {
            path: ':id',
            title: 'Crop · Krishi',
            loadComponent: () => import('./features/crops/crop-detail').then((m) => m.CropDetail),
          },
        ],
      },
      {
        path: 'people',
        title: 'Owners & Sharecroppers · Krishi',
        providers: [
          ...provideCollection(partiesFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(agreementsFeature),
          ...provideCollection(advancesFeature),
        ],
        loadComponent: () => import('./features/people/party-list').then((m) => m.PartyList),
      },
      {
        path: 'advances',
        // Providers on the parent, same as agreements: the list and the detail
        // page share one registration and navigating between them does not
        // refetch — which is also what keeps the undo buffer alive across the
        // navigation the withdraw flow makes.
        providers: [
          ...provideCollection(advancesFeature),
          ...provideCollection(agreementsFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(partiesFeature),
          ...provideCollection(seasonsFeature),
        ],
        children: [
          {
            path: '',
            title: 'Advances & Loans · Krishi',
            loadComponent: () =>
              import('./features/advances/advance-list').then((m) => m.AdvanceList),
          },
          {
            path: ':id',
            title: 'Advance · Krishi',
            loadComponent: () =>
              import('./features/advances/advance-detail').then((m) => m.AdvanceDetail),
          },
        ],
      },
      {
        path: 'cycles',
        providers: [
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(cropsFeature),
          ...provideCollection(cropVarietiesFeature),
          ...provideCollection(partiesFeature),
          ...provideCollection(seasonsFeature),
          ...provideCollection(agreementsFeature),
        ],
        children: [
          {
            path: '',
            title: 'Cultivation Cycles · Krishi',
            loadComponent: () => import('./features/cycles/cycle-list').then((m) => m.CycleList),
          },
          {
            path: ':id',
            title: 'Cycle · Krishi',
            loadComponent: () =>
              import('./features/cycles/cycle-detail').then((m) => m.CycleDetail),
          },
        ],
      },
      {
        path: 'calendar',
        title: 'Farming Calendar · Krishi',
        providers: [
          ...provideCollection(calendarTasksFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(cropVarietiesFeature),
        ],
        loadComponent: () =>
          import('./features/calendar/calendar-board').then((m) => m.CalendarBoard),
      },
      {
        path: 'activities',
        title: 'Farming Activities · Krishi',
        providers: [
          ...provideCollection(farmingActivitiesFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(agreementsFeature),
        ],
        loadComponent: () =>
          import('./features/activities/activity-list').then((m) => m.ActivityList),
      },
      {
        path: 'monitoring',
        title: 'Crop Monitoring · Krishi',
        providers: [
          ...provideCollection(monitoringLogsFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(landsFeature),
        ],
        loadComponent: () =>
          import('./features/monitoring/monitoring-list').then((m) => m.MonitoringList),
      },
      {
        path: 'harvests',
        title: 'Harvests · Krishi',
        providers: [
          ...provideCollection(harvestsFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(landsFeature),
        ],
        loadComponent: () => import('./features/harvests/harvest-list').then((m) => m.HarvestList),
      },
      {
        path: 'post-harvest',
        title: 'Post-Harvest · Krishi',
        providers: [
          ...provideCollection(processingBatchesFeature),
          ...provideCollection(harvestsFeature),
          ...provideCollection(stockLotsFeature),
        ],
        loadComponent: () =>
          import('./features/post-harvest/process-list').then((m) => m.ProcessList),
      },
      {
        path: 'inventory',
        title: 'Storage & Inventory · Krishi',
        providers: [
          ...provideCollection(stockLotsFeature),
          ...provideCollection(salesFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(agreementsFeature),
        ],
        loadComponent: () => import('./features/inventory/stock-list').then((m) => m.StockList),
      },
      {
        path: 'sales',
        title: 'Sales · Krishi',
        providers: [
          ...provideCollection(salesFeature),
          ...provideCollection(stockLotsFeature),
          ...provideCollection(cultivationCyclesFeature),
        ],
        loadComponent: () => import('./features/sales/sale-list').then((m) => m.SaleList),
      },
      {
        path: 'settlements',
        title: 'Settlements · Krishi',
        providers: [
          ...provideCollection(settlementsFeature),
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(agreementsFeature),
          ...provideCollection(advancesFeature),
          ...provideCollection(salesFeature),
          ...provideCollection(farmingActivitiesFeature),
          ...provideCollection(financeEntriesFeature),
          ...provideCollection(disputesFeature),
          ...provideCollection(partiesFeature),
        ],
        loadComponent: () =>
          import('./features/settlements/settlement-list').then((m) => m.SettlementList),
      },
      {
        path: 'disputes',
        title: 'Disputes · Krishi',
        providers: [
          ...provideCollection(disputesFeature),
          ...provideCollection(settlementsFeature),
        ],
        loadComponent: () => import('./features/disputes/dispute-list').then((m) => m.DisputeList),
      },
      {
        path: 'finance',
        title: 'Finance · Krishi',
        providers: [
          ...provideCollection(financeEntriesFeature),
          ...provideCollection(partiesFeature),
          ...provideCollection(settlementsFeature),
        ],
        loadComponent: () => import('./features/finance/finance-list').then((m) => m.FinanceList),
      },
      {
        path: 'reports',
        title: 'Reports · Krishi',
        providers: [
          ...provideCollection(cultivationCyclesFeature),
          ...provideCollection(landsFeature),
          ...provideCollection(cropsFeature),
          ...provideCollection(seasonsFeature),
          ...provideCollection(partiesFeature),
          ...provideCollection(agreementsFeature),
          ...provideCollection(harvestsFeature),
          ...provideCollection(salesFeature),
          ...provideCollection(farmingActivitiesFeature),
          ...provideCollection(advancesFeature),
          ...provideCollection(settlementsFeature),
        ],
        loadComponent: () => import('./features/reports/report-board').then((m) => m.ReportBoard),
      },
      {
        path: 'audit',
        title: 'Audit Trail · Krishi',
        providers: [...provideCollection(auditLogsFeature)],
        loadComponent: () => import('./features/audit/audit-trail').then((m) => m.AuditTrail),
      },
      ...stubRoutes,
    ],
  },
  { path: '**', redirectTo: '' },
];
