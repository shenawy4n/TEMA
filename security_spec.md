# TEMA Security Specification & Adversarial Audit Plan

## 1. Data Invariants (Zero-Trust Multi-Tenant Isolation)

1. **Tenant Isolation**: Every document in any `organizations/{organizationId}/*` subcollection MUST have `organizationId == {organizationId}` and is accessible ONLY to active members verified in `/organizations/{organizationId}/members/{request.auth.uid}` with `status == 'active'`.
2. **No Self-Assigned Privilege Escalation**: A user cannot create or modify a `members/{userId}` document to assign themselves `owner` on an existing organization, nor can a non-owner change member roles or statuses.
3. **Atomic Onboarding Guarantee**: Creating an `organizations/{organizationId}` document requires `existsAfter(/organizations/{organizationId}/members/{request.auth.uid})` in the same atomic batch, and bootstrapping the owner `members/{uid}` document requires `!exists(/organizations/{organizationId})` and `getAfter(/organizations/{organizationId}).data.ownerId == request.auth.uid`.
4. **Verified Identity**: All reads/writes on tenant resources require `request.auth != null && request.auth.token.email_verified == true`.
5. **Financial Immutability**: Posted `payments` and `expenses` can NEVER be hard-deleted (`allow delete: if false`). Voiding transitions `status` to `'voided'`, which locks the document against all future updates.
6. **Append-Only Audit Trail**: `auditLogs` only allow `create` (with `actorId == request.auth.uid`) and `get`/`list` for `owner` or `accountant`. Updates and deletes are unconditionally denied (`false`).
7. **Temporal & Schema Integrity**: `createdAt` must equal `request.time` on create and remain immutable on update; `updatedAt` must equal `request.time` on create and update. All keys are strictly allowlisted (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update).

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Target Collection | Attack Vector | Expected Result |
|---|-------------------|---------------|-----------------|
| 1 | `users/{uid}` | Ghost field injection (`isAdmin: true`, `role: 'owner'`) during profile creation | `PERMISSION_DENIED` |
| 2 | `users/{otherUid}` | Cross-user PII read (`get` on another user's email/phone) | `PERMISSION_DENIED` |
| 3 | `organizations/{orgId}` | Creating an organization with `ownerId` spoofed to another UID | `PERMISSION_DENIED` |
| 4 | `organizations/{orgId}` | Creating an organization without atomically creating the owner member doc | `PERMISSION_DENIED` |
| 5 | `organizations/{orgId}/members/{uid}` | Non-owner user adding themselves as `role: 'owner'` to an existing org | `PERMISSION_DENIED` |
| 6 | `organizations/{orgId}/members/{uid}` | Teacher/Assistant promoting their own role to `owner` via `update` | `PERMISSION_DENIED` |
| 7 | `organizations/{orgId}/students/{id}` | Cross-tenant read/write by an authenticated user belonging to a different org | `PERMISSION_DENIED` |
| 8 | `organizations/{orgId}/students/{id}` | ID Poisoning (1500-char document ID or invalid characters `$#`) | `PERMISSION_DENIED` |
| 9 | `organizations/{orgId}/payments/{id}` | Hard deleting a posted payment record (`deleteDoc`) | `PERMISSION_DENIED` |
| 10 | `organizations/{orgId}/payments/{id}` | Modifying a `voided` payment record back to `posted` | `PERMISSION_DENIED` |
| 11 | `organizations/{orgId}/auditLogs/{id}` | Tampering with or deleting an existing audit log entry | `PERMISSION_DENIED` |
| 12 | `organizations/{orgId}/expenses/{id}` | Unverified email (`email_verified: false`) attempting write or spoofed `createdAt` timestamp | `PERMISSION_DENIED` |

## 3. Emulator Verification Plan

Run `firestore.rules.test.ts` against the Firebase Local Emulator Suite:
```bash
firebase emulators:exec --only firestore "npx vitest run firestore.rules.test.ts"
```
