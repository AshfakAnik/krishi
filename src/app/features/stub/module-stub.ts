import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MODULES } from '../../core/module-registry';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { Icon } from '../../shared/ui/icon';

/**
 * Placeholder for every module that has not been built yet. It names what is
 * planned, so navigation is never broken while the app is incomplete — a 404 in
 * a demo reads as a bug, a stub reads as a roadmap.
 *
 * The route path is read from the URL rather than passed in, so one route entry
 * per unbuilt module is all that is needed.
 */
@Component({
  selector: 'app-module-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, SectionCard, Icon],
  templateUrl: './module-stub.html',
  styleUrl: './module-stub.css',
})
export class ModuleStub {
  private readonly route = inject(ActivatedRoute);

  private readonly url = toSignal(this.route.url, { initialValue: [] });

  protected readonly entry = computed(() => {
    const path = this.url()[0]?.path ?? '';
    return MODULES.find((module) => module.path === path) ?? null;
  });

  protected readonly siblings = computed(() => {
    const entry = this.entry();
    return entry ? MODULES.filter((m) => m.group === entry.group && m.path !== entry.path) : [];
  });
}
