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

function parseAllowedOrigins(rawList: string): Set<string> {
  const allowed = new Set<string>();
  for (const item of rawList.split(',')) {
    const trimmed = item.trim();
    if (!trimmed || trimmed === '*' || trimmed.includes('*')) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        allowed.add(parsed.origin);
      }
    } catch {
      // Ignore invalid origin entries
    }
  }
  return allowed;
}

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
    const app = getAdminApp();

    let uid: string;
    try {
      const decoded = await getAuth(app).verifyIdToken(idToken, true);
      if (!decoded.email_verified) {
        res.status(403).json({ error: 'Verified email is required.' });
        return;
      }
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Unauthorized or expired token.' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Invalid JSON request payload.' });
      return;
    }

    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        res.status(400).json({ error: `Unexpected field: ${key}` });
        return;
      }
    }

    const organizationId = body.organizationId;
    if (typeof organizationId !== 'string' || !ORG_ID_REGEX.test(organizationId)) {
      res.status(400).json({ error: 'Invalid organizationId.' });
      return;
    }

    const rawPrompt = body.prompt;
    if (typeof rawPrompt !== 'string') {
      res.status(400).json({ error: 'Prompt must be a string.' });
      return;
    }

    const prompt = sanitizeText(rawPrompt);
    if (!prompt) {
      res.status(400).json({ error: 'Prompt cannot be empty.' });
      return;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      res.status(413).json({ error: 'Prompt exceeds maximum allowed length.' });
      return;
    }

    const task = typeof body.task === 'string' && ALLOWED_TASKS.has(body.task)
      ? body.task
      : 'general_assistant';

    // Authoritative server-side membership check in Firestore
    try {
      const db = getFirestore(app, firestoreDatabaseId.value());
      const memberSnap = await db
        .doc(`organizations/${organizationId}/members/${uid}`)
        .get();

      const memberData = memberSnap.data();
      if (
        !memberSnap.exists ||
        !memberData ||
        memberData.status !== 'active' ||
        memberData.organizationId !== organizationId
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
      res.status(429).json({ error: 'Rate limit exceeded.' });
      return;
    }

    try {
      const apiKey = geminiApiKey.value().trim();
      if (!apiKey) {
        res.status(503).json({ error: 'AI service is not configured.' });
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
    } catch {
      // Never return provider error details, keys, or stack traces
      res.status(502).json({ error: 'AI generation request failed.' });
    }
  }
);
