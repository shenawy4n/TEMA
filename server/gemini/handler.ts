import type { Request, Response } from 'express';
import type { GeminiClient } from './client';
import {
  SlidingWindowRateLimiter,
  sanitizeProviderError,
  validateAndSanitizeGeminiInput,
} from './security';
import type { VerifiedMembership, VerifiedUser } from './authVerifier';

export interface GeminiHandlerDeps {
  verifyToken: (
    authorizationHeader: string | undefined
  ) => Promise<
    { ok: true; user: VerifiedUser; idToken: string } | { ok: false; status: number; error: string }
  >;
  verifyMembership: (
    organizationId: string,
    uid: string,
    idToken: string
  ) => Promise<
    { ok: true; membership: VerifiedMembership } | { ok: false; status: number; error: string }
  >;
  geminiClient: GeminiClient;
  rateLimiter: SlidingWindowRateLimiter;
  getConfiguredSecretForRedaction?: () => string | undefined;
}

export function createGeminiHandler(deps: GeminiHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    // 1. Authenticate Firebase user
    const authResult = await deps.verifyToken(req.headers.authorization);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    // 2. Validate and sanitize request payload
    const validation = validateAndSanitizeGeminiInput(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { organizationId, prompt, task } = validation.value;

    // 3. Verify active organization membership server-side
    const memberResult = await deps.verifyMembership(
      organizationId,
      authResult.user.uid,
      authResult.idToken
    );
    if (!memberResult.ok) {
      res.status(memberResult.status).json({ error: memberResult.error });
      return;
    }

    // 4. Enforce per-user & per-organization rate limiting
    const rateKey = `${authResult.user.uid}:${memberResult.membership.organizationId}`;
    const rateCheck = deps.rateLimiter.check(rateKey);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      res.status(429).json({
        error: 'Rate limit exceeded. Please wait before sending more requests.',
      });
      return;
    }

    // 5. Execute Gemini call strictly server-side and return minimal response
    try {
      const result = await deps.geminiClient.generateText({ prompt, task });
      res.status(200).json({
        text: result.text,
        model: result.model,
      });
    } catch (error) {
      const secretVal = deps.getConfiguredSecretForRedaction?.();
      const safe = sanitizeProviderError(error, secretVal ? [secretVal] : []);
      res.status(safe.status).json({ error: safe.message });
    }
  };
}
