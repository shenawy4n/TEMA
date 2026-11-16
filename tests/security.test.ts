import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createApiApp } from '../server/app';
import { SlidingWindowRateLimiter } from '../server/gemini/security';
import {
  isPermissionDeniedError,
  resolveTenantAccessState,
} from '../src/lib/domain/tenantAccess';
import type { Organization, OrganizationMember } from '../src/types/domain';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

async function withServer(
  app: ReturnType<typeof createApiApp>,
  run: (baseUrl: string) => Promise<void>
) {
  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  try {
    const addr = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('TEMA Gemini Backend Security Controls', () => {
  const fakeSecret = 'AIzaSyTEST_DO_NOT_LEAK_SECRET_VALUE_999';

  it('1. rejects unauthenticated requests to /api/gemini/generate with 401', async () => {
    const app = createApiApp({
      geminiHandlerDeps: {
        geminiClient: {
          async generateText() {
            return { text: 'ok', model: 'gemini-4-hydrogen' };
          },
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: 'org_123',
          prompt: 'مرحبا',
        }),
      });
      expect(res.status).toBe(401);
      const data = (await res.json()) as { error?: string };
      expect(data.error).toBeDefined();
    });
  });

  it('2. rejects authenticated users who are not active members of the organization with 403', async () => {
    const app = createApiApp({
      geminiHandlerDeps: {
        verifyToken: async () => ({
          ok: true,
          idToken: 'valid_token',
          user: { uid: 'user_outsider', email: 'outsider@example.com', emailVerified: true },
        }),
        verifyMembership: async () => ({
          ok: false,
          status: 403,
          error: 'Active organization membership is required.',
        }),
        geminiClient: {
          async generateText() {
            return { text: 'should not execute', model: 'gemini-4-hydrogen' };
          },
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({
          organizationId: 'org_other_tenant',
          prompt: 'اعرض بيانات الطلاب',
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  it('3. rejects invalid payloads, unexpected fields, and oversized prompts/bodies', async () => {
    const app = createApiApp({
      geminiHandlerDeps: {
        verifyToken: async () => ({
          ok: true,
          idToken: 'valid_token',
          user: { uid: 'user_1', email: 'owner@example.com', emailVerified: true },
        }),
        verifyMembership: async () => ({
          ok: true,
          membership: { uid: 'user_1', organizationId: 'org_1', role: 'owner', status: 'active' },
        }),
        geminiClient: {
          async generateText() {
            return { text: 'ok', model: 'gemini-4-hydrogen' };
          },
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      // Unexpected ghost field (e.g. client-supplied role)
      const ghostRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({
          organizationId: 'org_1',
          prompt: 'اختبار',
          role: 'owner',
        }),
      });
      expect(ghostRes.status).toBe(400);

      // Invalid organizationId
      const badOrgRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({
          organizationId: '../etc/passwd',
          prompt: 'اختبار',
        }),
      });
      expect(badOrgRes.status).toBe(400);

      // Oversized prompt (> 2000 chars)
      const longPromptRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({
          organizationId: 'org_1',
          prompt: 'أ'.repeat(2500),
        }),
      });
      expect(longPromptRes.status).toBe(413);

      // Oversized HTTP body (> 16KB)
      const hugeBodyRes = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({
          organizationId: 'org_1',
          prompt: 'x'.repeat(20_000),
        }),
      });
      expect(hugeBodyRes.status).toBe(413);
    });
  });

  it('4. frontend bundle and client source contain no Gemini API key or @google/genai SDK', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const srcFiles: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) srcFiles.push(full);
      }
    };
    walk(srcRoot);

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('@google/genai');
      expect(content).not.toContain('VITE_GEMINI_API_KEY');
      expect(content).not.toMatch(/VITE_[A-Z0-9_]*(API_KEY|SECRET|PRIVATE_KEY)/);
      expect(content).not.toContain('GEMINI_API_KEY');
    }

    const distAssetsDir = path.resolve(process.cwd(), 'dist', 'assets');
    if (fs.existsSync(distAssetsDir)) {
      for (const file of fs.readdirSync(distAssetsDir)) {
        if (!file.endsWith('.js')) continue;
        const bundle = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
        expect(bundle).not.toContain('GEMINI_API_KEY');
        expect(bundle).not.toContain('GoogleGenAI');
        expect(bundle).not.toContain('generativelanguage.googleapis.com');

        // Any AIza* string in the bundle must ONLY be the public Firebase Web SDK apiKey
        const matches = bundle.match(/AIza[0-9A-Za-z_-]{20,}/g) ?? [];
        for (const match of matches) {
          expect(match).toBe(firebaseConfig.apiKey);
        }
      }
    }
  });

  it('5. Gemini API responses never return credentials or secret metadata', async () => {
    const app = createApiApp({
      geminiHandlerDeps: {
        verifyToken: async () => ({
          ok: true,
          idToken: 'valid_token',
          user: { uid: 'user_1', email: 'owner@example.com', emailVerified: true },
        }),
        verifyMembership: async () => ({
          ok: true,
          membership: { uid: 'user_1', organizationId: 'org_1', role: 'owner', status: 'active' },
        }),
        geminiClient: {
          async generateText() {
            return { text: 'ملخص الدرس جاهز', model: 'gemini-4-hydrogen' };
          },
        },
        getConfiguredSecretForRedaction: () => fakeSecret,
      },
    });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({
          organizationId: 'org_1',
          prompt: 'لخص الدرس',
          task: 'lesson_summary',
        }),
      });
      expect(res.status).toBe(200);
      const rawBody = await res.text();
      expect(rawBody).not.toContain(fakeSecret);
      expect(rawBody).not.toContain('apiKey');
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['model', 'text']);
    });
  });

  it('6. provider errors never expose secrets or internal stack traces', async () => {
    const app = createApiApp({
      geminiHandlerDeps: {
        verifyToken: async () => ({
          ok: true,
          idToken: 'valid_token',
          user: { uid: 'user_1', email: 'owner@example.com', emailVerified: true },
        }),
        verifyMembership: async () => ({
          ok: true,
          membership: { uid: 'user_1', organizationId: 'org_1', role: 'owner', status: 'active' },
        }),
        geminiClient: {
          async generateText() {
            throw new Error(`API_KEY_INVALID for key=${fakeSecret} at /app/server/gemini/client.ts:42`);
          },
        },
        getConfiguredSecretForRedaction: () => fakeSecret,
      },
    });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({
          organizationId: 'org_1',
          prompt: 'اختبار خطأ',
        }),
      });
      expect(res.status).toBe(503);
      const rawBody = await res.text();
      expect(rawBody).not.toContain(fakeSecret);
      expect(rawBody).not.toContain('AIza');
      expect(rawBody).not.toContain('client.ts');
    });
  });

  it('7. rate limiting blocks abusive request bursts with 429', async () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    const app = createApiApp({
      geminiHandlerDeps: {
        verifyToken: async () => ({
          ok: true,
          idToken: 'valid_token',
          user: { uid: 'user_burst', email: 'owner@example.com', emailVerified: true },
        }),
        verifyMembership: async () => ({
          ok: true,
          membership: { uid: 'user_burst', organizationId: 'org_1', role: 'owner', status: 'active' },
        }),
        geminiClient: {
          async generateText() {
            return { text: 'ok', model: 'gemini-4-hydrogen' };
          },
        },
        rateLimiter: limiter,
      },
    });

    await withServer(app, async (baseUrl) => {
      const send = () =>
        fetch(`${baseUrl}/api/gemini/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid_token',
          },
          body: JSON.stringify({ organizationId: 'org_1', prompt: 'طلب' }),
        });

      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);
      const blocked = await send();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBeTruthy();
    });
  });

  it('8. Firestore rules preserve default-deny and strict tenant-isolation guards', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    expect(rules).toContain('match /{document=**} {\n      allow read, write: if false;');
    expect(rules).toContain('request.auth.token.email_verified == true');
    expect(rules).toContain('isActiveMember(orgId)');
    expect(rules).toContain('getMemberData(orgId).organizationId == orgId');
    expect(rules).not.toMatch(/allow\s+(read|write)\s*:\s*if\s+true\s*;/);
  });

  it('9. CORS allows exact preview origin on OPTIONS preflight & POST, rejects unauthorized origins and wildcards', async () => {
    const { resolveAllowedOrigins } = await import('../server/app');
    const previewOrigin = 'https://ais-dev-73nihro47ibujqqkjuhktn-919097631052.europe-west2.run.app';
    const evilOrigin = 'https://evil-domain.example.com';

    // Production resolution excludes localhost and rejects wildcard '*'
    const prodOrigins = resolveAllowedOrigins([previewOrigin, '*', 'https://*.example.com'], {
      isProduction: true,
    });
    expect(prodOrigins).toContain(previewOrigin);
    expect(prodOrigins).not.toContain('*');
    expect(prodOrigins).not.toContain('https://*.example.com');
    expect(prodOrigins).not.toContain('http://localhost:3000');

    const app = createApiApp({
      allowedOrigins: [previewOrigin],
      isProduction: true,
      geminiHandlerDeps: {
        verifyToken: async () => ({
          ok: true,
          idToken: 'valid_token',
          user: { uid: 'user_1', email: 'owner@example.com', emailVerified: true },
        }),
        verifyMembership: async () => ({
          ok: true,
          membership: { uid: 'user_1', organizationId: 'org_1', role: 'owner', status: 'active' },
        }),
        geminiClient: {
          async generateText() {
            return { text: 'ok', model: 'gemini-4-hydrogen' };
          },
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      // Allowed origin OPTIONS preflight
      const allowedPreflight = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'OPTIONS',
        headers: {
          Origin: previewOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });
      expect(allowedPreflight.status).toBe(204);
      expect(allowedPreflight.headers.get('access-control-allow-origin')).toBe(previewOrigin);
      expect(allowedPreflight.headers.get('access-control-allow-origin')).not.toBe('*');
      expect(allowedPreflight.headers.get('vary')).toContain('Origin');

      // Allowed origin POST
      const allowedPost = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          Origin: previewOrigin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({ organizationId: 'org_1', prompt: 'مرحبا' }),
      });
      expect(allowedPost.status).toBe(200);
      expect(allowedPost.headers.get('access-control-allow-origin')).toBe(previewOrigin);

      // Unauthorized origin OPTIONS preflight rejected
      const deniedPreflight = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'OPTIONS',
        headers: {
          Origin: evilOrigin,
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(deniedPreflight.status).toBe(403);
      expect(deniedPreflight.headers.get('access-control-allow-origin')).toBeNull();

      // Unauthorized origin POST rejected
      const deniedPost = await fetch(`${baseUrl}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          Origin: evilOrigin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_token',
        },
        body: JSON.stringify({ organizationId: 'org_1', prompt: 'مرحبا' }),
      });
      expect(deniedPost.status).toBe(403);
      expect(deniedPost.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  it('10. Firestore rules enforce active organization status and TenantAccess state blocks suspended orgs/memberships', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    expect(rules).toContain('function isActiveOrganization(orgId)');
    expect(rules).toContain("getOrgData(orgId).status == 'active'");
    const activeMemberMatch = rules.match(/function isActiveMember\(orgId\)\s*\{[\s\S]*?\}/);
    expect(activeMemberMatch?.[0]).toContain('isActiveOrganization(orgId)');

    const sampleOrg: Organization = {
      id: 'org_1',
      name: 'أكاديمية النور',
      type: 'educational_center',
      ownerId: 'uid_owner',
      ownerName: 'أحمد',
      phone: '01001234567',
      email: 'owner@example.com',
      city: 'القاهرة',
      currency: 'EGP',
      language: 'ar',
      themePreference: 'light',
      academicYear: '2026-2027',
      status: 'active',
      createdAt: null,
      updatedAt: null,
    };
    const activeMember: OrganizationMember = {
      uid: 'uid_owner',
      organizationId: 'org_1',
      displayName: 'أحمد',
      email: 'owner@example.com',
      role: 'owner',
      status: 'active',
      createdAt: null,
      updatedAt: null,
    };

    // Active org + active member grants access
    expect(
      resolveTenantAccessState({
        orgResult: { status: 'fulfilled', value: sampleOrg },
        memberResult: { status: 'fulfilled', value: activeMember },
        isPermissionDenied: isPermissionDeniedError,
        formatError: (e) => String(e),
      })
    ).toEqual({
      organization: sampleOrg,
      membership: activeMember,
      tenantBlockReason: null,
      error: null,
    });

    // Suspended org doc blocks access cleanly
    expect(
      resolveTenantAccessState({
        orgResult: { status: 'fulfilled', value: { ...sampleOrg, status: 'suspended' } },
        memberResult: { status: 'fulfilled', value: activeMember },
        isPermissionDenied: isPermissionDeniedError,
        formatError: (e) => String(e),
      })
    ).toEqual({
      organization: null,
      membership: activeMember,
      tenantBlockReason: 'organization_suspended',
      error: null,
    });

    // Permission-denied org read (enforced by firestore.rules when org is suspended) while member doc is active -> organization_suspended
    const wrappedDenied = new Error(
      JSON.stringify({
        error: 'Missing or insufficient permissions.',
        operationType: 'get',
        path: 'organizations/org_1',
      })
    );
    expect(isPermissionDeniedError(wrappedDenied)).toBe(true);
    expect(
      resolveTenantAccessState({
        orgResult: { status: 'rejected', reason: wrappedDenied },
        memberResult: { status: 'fulfilled', value: activeMember },
        isPermissionDenied: isPermissionDeniedError,
        formatError: (e) => String(e),
      })
    ).toEqual({
      organization: null,
      membership: activeMember,
      tenantBlockReason: 'organization_suspended',
      error: null,
    });

    // Suspended membership blocks access cleanly even if org read fails with permission-denied
    expect(
      resolveTenantAccessState({
        orgResult: { status: 'rejected', reason: { code: 'permission-denied' } },
        memberResult: {
          status: 'fulfilled',
          value: { ...activeMember, status: 'suspended' },
        },
        isPermissionDenied: isPermissionDeniedError,
        formatError: (e) => String(e),
      })
    ).toEqual({
      organization: null,
      membership: { ...activeMember, status: 'suspended' },
      tenantBlockReason: 'membership_suspended',
      error: null,
    });

    // Transient network error preserves error state for retry UI instead of misclassifying as suspended
    expect(
      resolveTenantAccessState({
        orgResult: { status: 'rejected', reason: { code: 'unavailable' } },
        memberResult: { status: 'fulfilled', value: activeMember },
        isPermissionDenied: isPermissionDeniedError,
        formatError: () => 'NETWORK_ERROR',
      })
    ).toEqual({
      organization: null,
      membership: null,
      tenantBlockReason: null,
      error: 'NETWORK_ERROR',
    });

    // No membership + permission-denied org read routes to onboarding without false block
    expect(
      resolveTenantAccessState({
        orgResult: { status: 'rejected', reason: wrappedDenied },
        memberResult: { status: 'fulfilled', value: null },
        isPermissionDenied: isPermissionDeniedError,
        formatError: (e) => String(e),
      })
    ).toEqual({
      organization: null,
      membership: null,
      tenantBlockReason: null,
      error: null,
    });
  });

  it('11. Firestore rules and financial services enforce Step B ledgerEntries parent linkage, amount consistency, and deterministic anti-duplication IDs', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const financeService = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/financeService.ts'),
      'utf8'
    );
    const temaRoutes = fs.readFileSync(
      path.resolve(process.cwd(), 'server/api/temaRoutes.ts'),
      'utf8'
    );

    // Rules enforce parent transaction linkage, piaster/EGP consistency, and deterministic IDs
    expect(rules).toContain('math.abs((data.amount * 100) - data.amountPiasters) < 0.001');
    expect(rules).toContain('function isValidPaymentCreateChargeLedger(orgId, entryId)');
    expect(rules).toContain('function isValidPaymentCreateInitPayLedger(orgId, entryId)');
    expect(rules).toContain('function isValidPaymentSettlementLedger(orgId, entryId)');
    expect(rules).toContain('function isValidPaymentReversalLedger(orgId, entryId)');
    expect(rules).toContain('function isValidPaymentAdjustmentLedger(orgId, entryId)');
    expect(rules).toContain('function isValidExpenseLedger(orgId, entryId)');
    expect(rules).toContain("entryId == (incoming().entityId + '_charge')");
    expect(rules).toContain("entryId == (incoming().entityId + '_pay_init')");
    expect(rules).toContain("entryId == (incoming().entityId + '_rev_charge')");
    expect(rules).toContain("entryId == (incoming().entityId + '_rev_paid')");
    expect(rules).toContain("entryId == ('ldg_adj_' + incoming().idempotencyKey)");

    // Services and REST routes use matching deterministic IDs instead of unlinked random ldg IDs
    for (const source of [financeService, temaRoutes]) {
      expect(source).toContain('`${generatedPaymentId}_charge`'.replace('generatedPaymentId', source.includes('generatedPaymentId') ? 'generatedPaymentId' : 'paymentId'));
      expect(source).toContain('_pay_init`');
      expect(source).toContain('_pay_${settlement.newPaidPiasters}`');
      expect(source).toContain('_rev_charge`');
      expect(source).toContain('_rev_paid`');
      expect(source).toContain('${expenseId}_charge`');
    }
    expect(financeService).toContain('`${expenseId}_rev_charge`');
    expect(financeService).toContain('`ldg_adj_${effectiveKey}`');
  });

  it('12. Step C groups.studentCount hardening & Step B cumulative payment adjustment limits are enforced in rules, domain, services, and API', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const ledgerDomain = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/domain/ledger.ts'),
      'utf8'
    );
    const financeService = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/financeService.ts'),
      'utf8'
    );
    const groupService = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/groupService.ts'),
      'utf8'
    );
    const reconciliationService = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/reconciliationService.ts'),
      'utf8'
    );
    const temaRoutes = fs.readFileSync(
      path.resolve(process.cwd(), 'server/api/temaRoutes.ts'),
      'utf8'
    );

    // Step C: no open owner/accountant studentCount bypass, strict two-way group <-> enrollment coupling
    expect(rules).not.toContain("affectedKeys().hasOnly(['studentCount', 'updatedAt'])");
    expect(rules).toContain('function isValidGroupEnrollmentIncrement(orgId, groupId)');
    expect(rules).toContain('function isValidGroupEnrollmentDecrement(orgId, groupId)');
    expect(rules).toContain('function isValidEnrollmentGroupLinkOnActivate(orgId, enrollmentId)');
    expect(rules).toContain('function isValidEnrollmentGroupLinkOnRemove(orgId, enrollmentId)');
    expect(rules).toContain('&& !(\'lastEnrollmentId\' in incoming())');
    expect(groupService).toContain('lastEnrollmentId: enrollmentId');
    expect(temaRoutes).toContain('lastEnrollmentId: enrollmentId');
    expect(reconciliationService).toContain('/api/v1/organizations/${encodeURIComponent(organizationId)}/reconcile');
    expect(temaRoutes).toContain('adminCommitWrites');

    // Step B residual risk: cumulative adjustment counters enforced across rules, domain, service, and REST API
    expect(rules).toContain('function isValidPaymentAdjustmentCounterUpdate(orgId, paymentId)');
    expect(rules).toContain('adjustedCreditPiasters <= incoming().amountPiasters');
    expect(rules).toContain('adjustedDebitPiasters <= incoming().amountPiasters');
    expect(ledgerDomain).toContain('export function validateAdjustmentAgainstPayment(');
    expect(financeService).toContain('validateAdjustmentAgainstPayment(');
    expect(temaRoutes).toContain("'/organizations/:orgId/payments/:paymentId/adjust'");
    expect(temaRoutes).toContain('validateAdjustmentAgainstPayment(');
  });
});
