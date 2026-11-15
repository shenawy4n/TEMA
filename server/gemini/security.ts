export type GeminiTaskType =
  | 'general_assistant'
  | 'lesson_summary'
  | 'parent_message'
  | 'study_plan';

export interface ValidatedGeminiRequest {
  organizationId: string;
  prompt: string;
  task: GeminiTaskType;
}

const ALLOWED_KEYS = new Set(['organizationId', 'prompt', 'task']);
const ALLOWED_TASKS = new Set<GeminiTaskType>([
  'general_assistant',
  'lesson_summary',
  'parent_message',
  'study_plan',
]);
const ORG_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
export const MAX_PROMPT_LENGTH = 2000;

export function sanitizePromptText(raw: string): string {
  // Strip ASCII control characters except newline (\n) and tab (\t)
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

export function validateAndSanitizeGeminiInput(
  body: unknown
): { ok: true; value: ValidatedGeminiRequest } | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Invalid JSON request payload.' };
  }

  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, status: 400, error: `Unexpected field in request: ${key}` };
    }
  }

  const rawOrgId = record.organizationId;
  if (typeof rawOrgId !== 'string' || !ORG_ID_REGEX.test(rawOrgId)) {
    return { ok: false, status: 400, error: 'A valid organizationId is required.' };
  }

  const rawPrompt = record.prompt;
  if (typeof rawPrompt !== 'string') {
    return { ok: false, status: 400, error: 'Prompt must be a non-empty string.' };
  }

  const sanitizedPrompt = sanitizePromptText(rawPrompt);
  if (sanitizedPrompt.length === 0) {
    return { ok: false, status: 400, error: 'Prompt cannot be empty.' };
  }
  if (sanitizedPrompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      status: 413,
      error: `Prompt exceeds maximum allowed length of ${MAX_PROMPT_LENGTH} characters.`,
    };
  }

  const rawTask = record.task ?? 'general_assistant';
  if (typeof rawTask !== 'string' || !ALLOWED_TASKS.has(rawTask as GeminiTaskType)) {
    return { ok: false, status: 400, error: 'Unsupported AI task type.' };
  }

  return {
    ok: true,
    value: {
      organizationId: rawOrgId,
      prompt: sanitizedPrompt,
      task: rawTask as GeminiTaskType,
    },
  };
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(maxRequests = 20, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((ts) => ts > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] ?? now;
      const retryAfterMs = Math.max(1000, oldest + this.windowMs - now);
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    if (this.hits.size > 5000) {
      for (const [k, list] of this.hits.entries()) {
        if (list.every((ts) => ts <= windowStart)) {
          this.hits.delete(k);
        }
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function redactSensitiveText(input: string, extraSecrets: string[] = []): string {
  let redacted = input
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[^\s"',}]+/gi, '[REDACTED_CREDENTIAL]');

  for (const secret of extraSecrets) {
    if (secret && secret.length >= 6) {
      redacted = redacted.split(secret).join('[REDACTED_SECRET]');
    }
  }
  return redacted;
}

export function sanitizeProviderError(
  error: unknown,
  knownSecrets: string[] = []
): { status: number; message: string } {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const safeMessage = redactSensitiveText(rawMessage, knownSecrets);
  const lower = safeMessage.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('api key not valid') ||
    lower.includes('missing gemini_api_key')
  ) {
    return {
      status: 503,
      message: 'خدمة الذكاء الاصطناعي غير مهيأة حالياً على الخادم.',
    };
  }

  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'تم الوصول إلى الحد المؤقت لطلبات الذكاء الاصطناعي. يرجى المحاولة بعد قليل.',
    };
  }

  return {
    status: 502,
    message: 'تعذر إتمام الطلب عبر خدمة الذكاء الاصطناعي حالياً.',
  };
}
