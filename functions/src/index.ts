import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const firestoreDatabaseId = defineString('FIRESTORE_DATABASE_ID', {
  default: 'ai-studio-26bef118-7d8b-4d12-b18f-28e49ed407f5',
});
const allowedOriginsParam = defineString('ALLOWED_ORIGINS', {
  default: 'https://gen-lang-client-0151650891.web.app,https://gen-lang-client-0151650891.firebaseapp.com',
});

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function parseAllowedOrigins(rawList: string): Set<string> {
  const allowed = new Set<string>();
  for (const item of rawList.split(',')) {
    const trimmed = item.trim();
    if (!trimmed || trimmed === '*' || trimmed.includes('*')) continue;
    try {
      const parsed = new URL(trimmed);
      // Production Cloud Functions only accept HTTPS origins and never allow localhost
      if (parsed.protocol === 'https:' && !isLocalhostHost(parsed.hostname)) {
        allowed.add(parsed.origin);
      }
    } catch {
      // Ignore invalid origin entries
    }
  }
  return allowed;
}

const VALID_ROLES = new Set(['owner', 'teacher', 'assistant', 'accountant']);
const ALLOWED_KEYS = new Set(['organizationId', 'prompt', 'task']);
const ALLOWED_TASKS = new Set([
  'general_assistant',
  'lesson_summary',
  'parent_message',
  'study_plan',
]);
const ORG_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_PROMPT_LENGTH = 2000;
const MAX_BODY_BYTES = 16 * 1024;

const SYSTEM_INSTRUCTIONS: Record<string, string> = {
  general_assistant:
    'أنت مساعد تعليمي وإداري محترف لمنصة TEMA لإدارة التعليم في مصر. أجب باللغة العربية بوضوح وإيجاز ومهنية.',
  lesson_summary:
    'أنت مساعد تربوي في منصة TEMA. لخّص نقاط الدرس الأساسية بأسلوب منظم ومناسب للطلاب في مصر.',
  parent_message:
    'أنت مساعد تواصل في منصة TEMA. صُغ رسالة مهذبة ومختصرة لولي الأمر باللغة العربية.',
  study_plan:
    'أنت مخطط أكاديمي في منصة TEMA. اقترح خطة مراجعة عملية ومختصرة باللغة العربية.',
};

// NOTE: In-memory per-instance limiter (applies independently per warm container up to maxInstances=10).
// For strict global quota enforcement at scale, pair with Redis/Firestore counters, App Check, and Cloud Armor.
const rateHits = new Map<string, number[]>();

function checkRateLimit(key: string, maxRequests = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const recent = (rateHits.get(key) ?? []).filter((ts) => ts > windowStart);
  if (recent.length >= maxRequests) {
    rateHits.set(key, recent);
    return false;
  }
  recent.push(now);
  rateHits.set(key, recent);
  return true;
}

function sanitizeText(raw: string): string {
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

function getAdminApp() {
  return getApps().length > 0 ? getApps()[0] : initializeApp();
}

export const geminiGenerate = onRequest(
  {
    region: 'europe-west1',
    secrets: [geminiApiKey],
    cors: false,
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');

    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const allowedOrigins = parseAllowedOrigins(allowedOriginsParam.value());

    if (originHeader) {
      if (!allowedOrigins.has(originHeader)) {
        res.status(403).json({ error: 'Origin is not permitted by CORS policy.' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', originHeader);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      if (!originHeader) {
        res.status(400).json({ error: 'Missing Origin header for CORS preflight.' });
        return;
      }
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_BODY_BYTES || (req.rawBody && req.rawBody.length > MAX_BODY_BYTES)) {
      res.status(413).json({ error: 'Request payload exceeds 16KB limit.' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header.' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken || idToken.length > 8192) {
      res.status(401).json({ error: 'Invalid authentication token.' });
      return;
    }

    const app = getAdminApp();

    let uid: string;
    try {
      const decoded = await getAuth(app).verifyIdToken(idToken, true);
      if (!decoded.email_verified) {
        res.status(403).json({ error: 'Email verification is required before using protected operations.' });
        return;
      }
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Unauthorized or expired session token.' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Invalid JSON request payload.' });
      return;
    }

    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        res.status(400).json({ error: `Unexpected field in request: ${key}` });
        return;
      }
    }

    const organizationId = body.organizationId;
    if (typeof organizationId !== 'string' || !ORG_ID_REGEX.test(organizationId)) {
      res.status(400).json({ error: 'A valid organizationId is required.' });
      return;
    }

    const rawPrompt = body.prompt;
    if (typeof rawPrompt !== 'string') {
      res.status(400).json({ error: 'Prompt must be a non-empty string.' });
      return;
    }

    const prompt = sanitizeText(rawPrompt);
    if (!prompt) {
      res.status(400).json({ error: 'Prompt cannot be empty.' });
      return;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      res.status(413).json({ error: `Prompt exceeds maximum allowed length of ${MAX_PROMPT_LENGTH} characters.` });
      return;
    }

    const rawTask = body.task ?? 'general_assistant';
    if (typeof rawTask !== 'string' || !ALLOWED_TASKS.has(rawTask)) {
      res.status(400).json({ error: 'Unsupported AI task type.' });
      return;
    }
    const task = rawTask;

    // Authoritative server-side membership & organization status check in Firestore
    try {
      const db = getFirestore(app, firestoreDatabaseId.value());
      const [orgSnap, memberSnap] = await Promise.all([
        db.doc(`organizations/${organizationId}`).get(),
        db.doc(`organizations/${organizationId}/members/${uid}`).get(),
      ]);

      const orgData = orgSnap.data();
      if (!orgSnap.exists || !orgData || orgData.status !== 'active') {
        res.status(403).json({ error: 'Organization is missing or suspended.' });
        return;
      }

      const memberData = memberSnap.data();
      if (
        !memberSnap.exists ||
        !memberData ||
        memberData.uid !== uid ||
        memberData.organizationId !== organizationId ||
        memberData.status !== 'active' ||
        typeof memberData.role !== 'string' ||
        !VALID_ROLES.has(memberData.role)
      ) {
        res.status(403).json({ error: 'Active organization membership is required.' });
        return;
      }
    } catch {
      res.status(503).json({ error: 'Unable to verify organization membership.' });
      return;
    }

    if (!checkRateLimit(`${uid}:${organizationId}`)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before sending more requests.' });
      return;
    }

    try {
      const apiKey = geminiApiKey.value().trim();
      if (!apiKey) {
        res.status(503).json({ error: 'خدمة الذكاء الاصطناعي غير مهيأة حالياً على الخادم.' });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const model = 'gemini-4-hydrogen';
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTIONS[task],
        },
      });

      res.status(200).json({
        text: (response.text ?? '').trim(),
        model,
      });
    } catch (error) {
      // Never return provider error details, keys, or stack traces
      const msg = (error instanceof Error ? error.message : String(error ?? ''))
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
        .toLowerCase();
      if (
        msg.includes('api_key_invalid') ||
        msg.includes('permission_denied') ||
        msg.includes('api key not valid') ||
        msg.includes('missing gemini_api_key')
      ) {
        res.status(503).json({ error: 'خدمة الذكاء الاصطناعي غير مهيأة حالياً على الخادم.' });
        return;
      }
      if (msg.includes('resource_exhausted') || msg.includes('429') || msg.includes('quota')) {
        res.status(429).json({ error: 'تم الوصول إلى الحد المؤقت لطلبات الذكاء الاصطناعي. يرجى المحاولة بعد قليل.' });
        return;
      }
      res.status(502).json({ error: 'تعذر إتمام الطلب عبر خدمة الذكاء الاصطناعي حالياً.' });
    }
  }
);
