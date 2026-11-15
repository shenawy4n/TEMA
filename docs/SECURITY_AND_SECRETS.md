# TEMA — Security & Secret Management Guide

This document defines the mandatory secret management, backend Gemini API isolation, credential rotation, and verification procedures for **TEMA (Teacher Manager)**.

---

## 1. Where Secrets Are Stored

- **Production (Firebase Cloud Functions v2)**:
  - `GEMINI_API_KEY` is stored exclusively in **Google Cloud Secret Manager** and bound to the `geminiGenerate` function via `defineSecret('GEMINI_API_KEY')` in `functions/src/index.ts`.
  - Secrets are injected into the Cloud Functions container environment at runtime and are never written to source files, GitHub, or frontend builds.
- **Local / AI Studio Runtime (`server.ts`)**:
  - `GEMINI_API_KEY` is read strictly on the server via `process.env.GEMINI_API_KEY` (from AI Studio's Secrets panel or an ignored local `.env.local` file).
- **Frontend (`src/`)**:
  - **Zero secrets** exist in React/TypeScript frontend code. `VITE_*` variables must never hold API keys, tokens, or private credentials.
  - Note: `firebase-applet-config.json` contains Firebase Web Client SDK identifiers (`apiKey`, `projectId`, `appId`). Firebase Web API keys are public project identifiers by design; data protection is enforced by Firebase Authentication and `firestore.rules`.

---

## 2. Creating a New Gemini API Key (After Key Compromise)

If an older Gemini API key was exposed, consider it permanently compromised:

1. Open Google AI Studio / Google Cloud Console (`APIs & Services > Credentials`).
2. **Revoke / Delete** the compromised API key immediately.
3. Create a **new** API key in Google Cloud Console or Google AI Studio:
   - Restrict the key by **API restriction**: limit it strictly to **Generative Language API** (`generativelanguage.googleapis.com`).
   - Do not add HTTP referrer restrictions for server-side Cloud Functions keys (instead keep the key exclusively in Secret Manager; optionally restrict by server/egress policy if using dedicated static egress).
4. Never paste the real key into source files, `.env.example`, GitHub issues, or chat prompts.

---

## 3. Storing the Key in Google Cloud Secret Manager / Firebase Functions

Use the Firebase CLI (authenticated with an authorized maintainer account):

```bash
firebase functions:secrets:set GEMINI_API_KEY --project YOUR_FIREBASE_PROJECT_ID
```

When prompted, paste your newly generated key interactively in your terminal (it will not appear in shell history or files).

To inspect metadata (version status only, not secret values):

```bash
firebase functions:secrets:access GEMINI_API_KEY --project YOUR_FIREBASE_PROJECT_ID
```

---

## 4. Granting Least-Privilege Runtime Access

The Cloud Functions runtime service account (`YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com` or custom function service account) only needs the **Secret Manager Secret Accessor** role (`roles/secretmanager.secretAccessor`) scoped specifically to the `GEMINI_API_KEY` secret:

```bash
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --project="YOUR_FIREBASE_PROJECT_ID" \
  --member="serviceAccount:YOUR_FUNCTIONS_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

Do not grant `roles/secretmanager.admin` or project-wide `Owner`/`Editor` roles to the runtime service account.

---

## 5. Deploying the Backend Function & Security Rules

1. Install Cloud Functions dependencies and build TypeScript:
   ```bash
   cd functions && npm install && npm run build && cd ..
   ```
2. Deploy Firestore Security Rules and the Cloud Function:
   ```bash
   firebase deploy --only firestore:rules,functions --project YOUR_FIREBASE_PROJECT_ID
   ```
3. Configure the frontend's public endpoint URL (if hosting the SPA separately from Express) using a non-secret URL variable in your hosting build environment:
   ```bash
   VITE_GEMINI_ENDPOINT="https://europe-west1-YOUR_FIREBASE_PROJECT_ID.cloudfunctions.net/geminiGenerate"
   ```

---

## 6. Safe Local Development Configuration

1. Copy `.env.example` to `.env.local` (never `.env.production` committed to Git):
   ```bash
   cp .env.example .env.local
   ```
2. Fill in `GEMINI_API_KEY="YOUR_LOCAL_DEV_KEY"` inside `.env.local` (covered by `.gitignore` via `.env*`).
3. Start the server (`server.ts` serves both `/api/*` and the Vite dev middleware on port 3000):
   ```bash
   npm run dev
   ```
4. Never prefix `GEMINI_API_KEY` with `VITE_`. Never run `vite` with `define: { 'process.env.GEMINI_API_KEY': ... }`.

---

## 7. Rotating or Revoking a Compromised Key

1. Generate a new key in Google Cloud / AI Studio restricted to Generative Language API.
2. Push a new secret version to Secret Manager:
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY --project YOUR_FIREBASE_PROJECT_ID
   ```
3. Redeploy the function so new instances bind the latest secret version:
   ```bash
   firebase deploy --only functions:geminiGenerate --project YOUR_FIREBASE_PROJECT_ID
   ```
4. Delete/revoke the old key in Google Cloud Console (`APIs & Services > Credentials`) and destroy old Secret Manager versions if required.
5. If a secret was ever committed to a Git repository:
   - Deleting the file or creating a new repo does **not** revoke the key; Google Cloud revocation is mandatory.
   - Purge historical Git commits (e.g., `git filter-repo`) only with explicit team coordination and force-push controls, and verify via `gitleaks detect`.

---

## 8. Verifying the Frontend Bundle Contains No Secrets

Run the automated build and security test suite:

```bash
npm run build
npm test
```

You can also inspect the built bundle directly:

```bash
grep -rnE "GEMINI_API_KEY|@google/genai|generativelanguage\.googleapis\.com" dist/ || echo "Clean"
```

Verify `vite.config.ts` keeps `build.sourcemap: false` so production source maps are not published.

---

## 9. Manual Steps Required in Google Cloud / Firebase Console

1. **Revoke** the previously exposed Gemini API key in Google Cloud Console / AI Studio.
2. **Create** a new Gemini API key restricted to Generative Language API.
3. **Set** `GEMINI_API_KEY` in Google Cloud Secret Manager (`firebase functions:secrets:set GEMINI_API_KEY`).
4. **Enable Email/Password Auth** (if needed alongside Google Sign-In) in Firebase Console (`Authentication > Sign-in method`).
5. **Deploy** Cloud Functions (`firebase deploy --only functions`) from an authorized maintainer environment (Blaze plan is required by Firebase for Cloud Functions & Secret Manager).
6. **Optional hardening**: Enable **Firebase App Check** (reCAPTCHA Enterprise) and **Cloud Armor** in production for additional bot/DDoS protection.

---

## 10. CORS & `ALLOWED_ORIGINS` Configuration

All CORS allowlists are enforced strictly on the server (`server/app.ts` for Express and `functions/src/index.ts` for Firebase Cloud Functions v2). Wildcard (`*`) origins are explicitly rejected and never emitted.

### Google AI Studio Build Mode (Current Environment)
- `server.ts` loads server-only `.env.local` (ignored by Git) and runtime `APP_URL`.
- In non-production mode (`NODE_ENV !== 'production'`), `http://localhost:3000` and `http://127.0.0.1:3000` are automatically included alongside `APP_URL` and `ALLOWED_ORIGINS`.
- In production (`NODE_ENV === 'production'`), localhost origins are automatically excluded unless `ALLOW_LOCALHOST_CORS="true"` is explicitly set for temporary local verification.

### Updating `ALLOWED_ORIGINS` for Firebase Hosting or a Custom Domain
1. **Firebase Hosting (default domains)**:
   - `https://gen-lang-client-0151650891.web.app` and `https://gen-lang-client-0151650891.firebaseapp.com` are already included as project defaults.
2. **Custom Domain (e.g. `https://app.tema.edu.eg`)**:
   - **If deploying Firebase Cloud Functions v2 (`geminiGenerate`)**:
     Set the `ALLOWED_ORIGINS` parameter during deploy or in `functions/.env.gen-lang-client-0151650891` (not committed to Git):
     ```bash
     ALLOWED_ORIGINS="https://app.tema.edu.eg,https://gen-lang-client-0151650891.web.app,https://gen-lang-client-0151650891.firebaseapp.com"
     ```
     Then deploy:
     ```bash
     firebase deploy --only functions:geminiGenerate --project gen-lang-client-0151650891
     ```
   - **If deploying Express (`server.ts`) on Cloud Run / Node**:
     Set the server environment variable `ALLOWED_ORIGINS="https://app.tema.edu.eg,https://gen-lang-client-0151650891.web.app"` (and `NODE_ENV=production`) in your hosting service's environment configuration. `.env.local` is ignored when `NODE_ENV=production`.
   - Never add `*` to `ALLOWED_ORIGINS`, and always include the exact scheme and host (`https://...`, no trailing slash).

---

## 11. Security Verification, Emulator Tests & Serverless Rate-Limiting Limits

- **Cloud Functions Build**: Run `npm --prefix functions install && npm run build:functions` to verify `functions/lib/index.js` compiles cleanly.
- **Firestore Emulator Security Suite (`firestore.rules.test.ts`)**: Requires Java JRE/JDK (v21+) and Firebase CLI:
  ```bash
  npm run test:rules
  ```
- **Gitleaks CI Policy (`.gitleaks.toml` & `.github/workflows/security-scan.yml`)**: Scans full Git history (`fetch-depth: 0`) with summary leaks suppressed and allowlists only the public Firebase Web Client SDK identifier in `firebase-applet-config.json` and placeholders in `.env.example`.
- **Rate Limiting Scope**: Both `server/gemini/security.ts` and `functions/src/index.ts` use per-instance in-memory sliding windows (`20 req / 60s` per `uid:organizationId`). Across scaled Cloud Functions instances (`maxInstances: 10`), use Redis/Firestore atomic counters, Firebase App Check, and Cloud Armor for strict global quota enforcement.
