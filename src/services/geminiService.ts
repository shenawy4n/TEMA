import { auth } from '@/src/lib/firebase/config';

export type GeminiTaskType =
  | 'general_assistant'
  | 'lesson_summary'
  | 'parent_message'
  | 'study_plan';

export interface GeminiRequestPayload {
  organizationId: string;
  prompt: string;
  task?: GeminiTaskType;
}

export interface GeminiResponsePayload {
  text: string;
  model: string;
}

/**
 * Isolated client gateway for TEMA AI requests.
 * All Gemini API calls execute strictly on the authenticated server backend;
 * no API key or generative AI SDK is ever bundled in the browser.
 */
export async function generateViaBackend(
  payload: GeminiRequestPayload
): Promise<GeminiResponsePayload> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('يجب تسجيل الدخول أولاً قبل استخدام هذه الخدمة.');
  }

  const idToken = await currentUser.getIdToken();
  const endpoint = import.meta.env.VITE_GEMINI_ENDPOINT || '/api/gemini/generate';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      organizationId: payload.organizationId,
      prompt: payload.prompt,
      task: payload.task ?? 'general_assistant',
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    text?: string;
    model?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || 'تعذر تنفيذ الطلب على الخادم.');
  }

  return {
    text: data.text ?? '',
    model: data.model ?? 'gemini-4-hydrogen',
  };
}
