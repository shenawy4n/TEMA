export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^\d{2}:\d{2}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EGYPT_PHONE_PATTERN = /^[0-9+\s()-]{5,30}$/;

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function isValidEntityId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_PATTERN.test(id);
}

export function validateRequiredString(
  value: string,
  fieldLabel: string,
  minLength: number,
  maxLength: number
): string | null {
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    return `${fieldLabel} يجب أن يحتوي على ${minLength} أحرف على الأقل.`;
  }
  if (trimmed.length > maxLength) {
    return `${fieldLabel} يجب ألا يتجاوز ${maxLength} حرفاً.`;
  }
  return null;
}
