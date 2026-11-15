import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createGeminiClient } from './gemini/client';
import { createGeminiHandler, type GeminiHandlerDeps } from './gemini/handler';
import {
  verifyActiveOrganizationMembership,
  verifyFirebaseBearerToken,
} from './gemini/authVerifier';
import { SlidingWindowRateLimiter } from './gemini/security';

import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

export interface ApiAppOptions {
  allowedOrigins?: string[];
  isProduction?: boolean;
  geminiHandlerDeps?: Partial<GeminiHandlerDeps>;
}

const LOCAL_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function normalizeAllowedOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*' || trimmed.includes('*')) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function resolveAllowedOrigins(
  extraOrigins: string[] = [],
  options: { isProduction?: boolean } = {}
): string[] {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const allowLocalhostInProd = process.env.ALLOW_LOCALHOST_CORS === 'true';

  const firebaseHostingOrigins = [
    `https://${firebaseConfig.projectId}.web.app`,
    `https://${firebaseConfig.projectId}.firebaseapp.com`,
  ];

  const devDefaults = !isProduction || allowLocalhostInProd ? LOCAL_DEV_ORIGINS : [];

  const envOrigins = [
    process.env.APP_URL,
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
  ].filter((v): v is string => Boolean(v));

  const candidates = [
    ...firebaseHostingOrigins,
    ...devDefaults,
    ...envOrigins,
    ...extraOrigins,
  ];

  const normalized = new Set<string>();
  for (const candidate of candidates) {
    const origin = normalizeAllowedOrigin(candidate);
    if (!origin) continue;
    if (isProduction && !allowLocalhostInProd && isLocalhostOrigin(origin) && !extraOrigins.includes(candidate)) {
      continue;
    }
    normalized.add(origin);
  }

  return Array.from(normalized);
}

export function createApiApp(options: ApiAppOptions = {}) {
  const app = express();
  const allowedOrigins = resolveAllowedOrigins(options.allowedOrigins, {
    isProduction: options.isProduction,
  });

  app.disable('x-powered-by');

  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(
    '/api',
    cors({
      origin(origin, callback) {
        // Allow same-origin server/curl calls without Origin header, or strict allowlisted origins (never *)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      optionsSuccessStatus: 204,
      maxAge: 600,
    })
  );

  app.use('/api', express.json({ limit: '16kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  const deps: GeminiHandlerDeps = {
    verifyToken: options.geminiHandlerDeps?.verifyToken ?? verifyFirebaseBearerToken,
    verifyMembership:
      options.geminiHandlerDeps?.verifyMembership ?? verifyActiveOrganizationMembership,
    geminiClient:
      options.geminiHandlerDeps?.geminiClient ??
      createGeminiClient(() => process.env.GEMINI_API_KEY),
    rateLimiter:
      options.geminiHandlerDeps?.rateLimiter ?? new SlidingWindowRateLimiter(20, 60_000),
    getConfiguredSecretForRedaction:
      options.geminiHandlerDeps?.getConfiguredSecretForRedaction ??
      (() => process.env.GEMINI_API_KEY),
  };

  app.post('/api/gemini/generate', createGeminiHandler(deps));

  // Sanitized API error middleware (never exposes stack traces or secrets)
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'Request payload exceeds the 16KB size limit.' });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Malformed JSON payload.' });
      return;
    }
    if (err instanceof Error && err.message === 'CORS_ORIGIN_NOT_ALLOWED') {
      res.status(403).json({ error: 'Origin is not permitted by CORS policy.' });
      return;
    }
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
