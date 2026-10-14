import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MODULE_GROUPS, ModuleEntry, modulesFor } from '../core/module-registry';
import { SessionService } from '../core/session';
import { Icon } from '../shared/ui/icon';

interface NavGroup {
  name: string;
  entries: ModuleEntry[];
}

/**
 * Grouped, role-filtered navigation. Groups mirror the five lanes of the
 * activity diagram.
 *
 * Only entries the current role may follow are rendered — `roleGuard` enforces
 * the same list, and a link that silently redirects reads as a broken control.
 */
@Component({
  selector: 'app-sidebar-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon],
  templateUrl: './sidebar-nav.html',
  styleUrl: './sidebar-nav.css',
})
export class SidebarNav {
  /** Emitted so the mobile drawer can close itself after a navigation. */
  readonly navigated = output<void>();

  private readonly session = inject(SessionService);

  protected readonly groups = computed<NavGroup[]>(() => {
    const visible = modulesFor(this.session.role());
    return MODULE_GROUPS.map((name) => ({
      name,
      entries: visible.filter((entry) => entry.group === name),
    })).filter((group) => group.entries.length > 0);
  });
}
