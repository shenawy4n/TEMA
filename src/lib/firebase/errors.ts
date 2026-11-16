import { auth } from './config';
import { DomainValidationError } from '@/src/lib/domain/money';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (error instanceof DomainValidationError) {
    throw error;
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function getArabicErrorMessage(error: unknown): string {
  if (error instanceof DomainValidationError) {
    return error.message;
  }
  if (error instanceof Error) {
    const code =
      'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    const msg = error.message;
    if (
      code === 'permission-denied' ||
      msg.includes('permission-denied') ||
      msg.includes('Missing or insufficient permissions')
    ) {
      return 'ليس لديك صلاحية كافية لتنفيذ هذا الإجراء أو الوصول إلى هذه البيانات.';
    }
    if (msg.includes('Quota exceeded')) {
      return 'تم تجاوز الحد اليومي المجاني لعمليات قاعدة البيانات. يرجى المحاولة لاحقاً أو ترقية الخطة.';
    }
    if (
      code === 'unavailable' ||
      msg.includes('the client is offline') ||
      msg.includes('unavailable') ||
      msg.includes('network-request-failed')
    ) {
      return 'تعذر الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.';
    }
    if (msg.includes('auth/operation-not-allowed')) {
      return 'تسجيل الدخول بالبريد الإلكتروني وكلمة المرور غير مفعّل حالياً في Firebase Console. يمكنك استخدام تسجيل الدخول بحساب Google أو تفعيل Email/Password من لوحة تحكم Firebase.';
    }
    if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
      return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'هذا البريد الإلكتروني مسجل بالفعل. يمكنك تسجيل الدخول أو استعادة كلمة المرور.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 أحرف على الأقل.';
    }
    if (msg.includes('auth/too-many-requests')) {
      return 'تم إرسال عدد كبير من المحاولات. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.';
    }
    if (msg.includes('auth/popup-closed-by-user')) {
      return 'تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.';
    }
    try {
      const parsed = JSON.parse(msg) as Partial<FirestoreErrorInfo>;
      if (parsed.error) {
        if (parsed.error.includes('permission-denied') || parsed.error.includes('Missing or insufficient permissions')) {
          return 'ليس لديك صلاحية كافية لتنفيذ هذا الإجراء أو الوصول إلى هذه البيانات.';
        }
        return parsed.error;
      }
    } catch {
      // Not JSON, fall through
    }
    return msg;
  }
  return 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
}
