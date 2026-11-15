import { cn } from '@/src/lib/utils/cn';

interface BrandWordmarkProps {
  compact?: boolean;
  className?: string;
}

export function BrandWordmark({ compact = false, className }: BrandWordmarkProps) {
  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <div
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F2942] dark:bg-blue-600 text-white font-display-latin font-extrabold text-base tracking-tight border border-[#1E3A5F] dark:border-blue-500"
      >
        T
      </div>
      {!compact && (
        <span className="font-display-latin text-lg font-extrabold tracking-tight text-[#0F2942] dark:text-white whitespace-nowrap shrink-0">
          TEMA
        </span>
      )}
    </div>
  );
}
