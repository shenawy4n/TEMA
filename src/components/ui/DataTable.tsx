import { type ReactNode } from 'react';
import { cn } from '@/src/lib/utils/cn';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'right' | 'left' | 'center';
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-4 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap',
                    col.align === 'left' && 'text-left',
                    col.align === 'center' && 'text-center'
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'transition-colors',
                  onRowClick
                    ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
                    : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-sm text-slate-800 dark:text-slate-200 whitespace-nowrap',
                      col.numeric && 'tabular-nums',
                      col.align === 'left' && 'text-left',
                      col.align === 'center' && 'text-center'
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
