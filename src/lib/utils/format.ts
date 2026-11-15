export function formatCurrencyEGP(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(safe)} ج.م`;
}

export function formatNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('ar-EG').format(safe);
}

export function formatDateArabic(dateInput: unknown): string {
  if (!dateInput) return '—';
  let date: Date | null = null;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else if (typeof dateInput === 'string') {
    const parsed = new Date(dateInput);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (
    typeof dateInput === 'object' &&
    dateInput !== null &&
    'toDate' in dateInput &&
    typeof (dateInput as { toDate: () => Date }).toDate === 'function'
  ) {
    date = (dateInput as { toDate: () => Date }).toDate();
  }
  if (!date) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function generateId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}
