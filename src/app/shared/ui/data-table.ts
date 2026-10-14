import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Tone } from '../../core/models/common';
import { EmptyState } from './empty-state';
import { Icon } from './icon';
import { StatusBadge } from './status-badge';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Render with tabular figures — use for codes, quantities and money. */
  mono?: boolean;
  value: (row: T) => string | number;
  /** Render as a status badge instead of plain text. */
  badge?: (row: T) => { label: string; tone: Tone } | null;
  /** Override the sort key when the displayed value is not sortable. */
  sortValue?: (row: T) => string | number;
}

/**
 * Hand-rolled sortable, filterable table. Generic over the row type so column
 * accessors stay type-checked in templates. Wide content scrolls inside its own
 * container so the page body never scrolls horizontally.
 */
@Component({
  selector: 'ui-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, StatusBadge, EmptyState],
  templateUrl: './data-table.html',
  styleUrl: './data-table.css',
})
export class DataTable<T extends { id: string }> {
  readonly columns = input.required<Column<T>[]>();
  readonly rows = input.required<readonly T[]>();
  readonly loading = input(false);
  readonly searchable = input(true);
  readonly searchPlaceholder = input('Search records');
  readonly rowLink = input<((row: T) => (string | number)[]) | null>(null);
  readonly emptyTitle = input('No records match');
  readonly emptyHint = input('');

  protected readonly query = signal('');
  protected readonly sortKey = signal<string | null>(null);
  protected readonly sortDir = signal<'asc' | 'desc'>('asc');
  protected readonly skeletons = [0, 1, 2, 3, 4];

  protected readonly view = computed(() => {
    const term = this.query().trim().toLowerCase();
    const cols = this.columns();
    let out = this.rows().slice();

    if (term) {
      out = out.filter((row) =>
        cols.some((col) => String(col.value(row)).toLowerCase().includes(term)),
      );
    }

    const key = this.sortKey();
    const col = cols.find((c) => c.key === key);
    if (col) {
      const read = col.sortValue ?? col.value;
      const dir = this.sortDir() === 'asc' ? 1 : -1;
      out.sort((a, b) => {
        const left = read(a);
        const right = read(b);
        if (typeof left === 'number' && typeof right === 'number') {
          return (left - right) * dir;
        }
        return String(left).localeCompare(String(right)) * dir;
      });
    }
    return out;
  });

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected toggleSort(key: string): void {
    if (this.sortKey() === key) {
      this.sortDir.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sortKey.set(key);
    this.sortDir.set('asc');
  }

  protected ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) {
      return 'none';
    }
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }
}
