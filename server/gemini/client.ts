import { GoogleGenAI } from '@google/genai';
import type { GeminiTaskType } from './security';

export interface GeminiGenerationResult {
  text: string;
  model: string;
}

export interface GeminiClient {
  generateText(input: { prompt: string; task: GeminiTaskType }): Promise<GeminiGenerationResult>;
}

const SYSTEM_INSTRUCTIONS: Record<GeminiTaskType, string> = {
  general_assistant:
    'أنت مساعد تعليمي وإداري محترف لمنصة TEMA لإدارة التعليم في مصر. أجب باللغة العربية بوضوح وإيجاز ومهنية.',
  lesson_summary:
    'أنت مساعد تربوي في منصة TEMA. لخّص نقاط الدرس الأساسية بأسلوب منظم ومناسب للطلاب في مصر.',
  parent_message:
    'أنت مساعد تواصل في منصة TEMA. صُغ رسالة مهذبة ومختصرة لولي الأمر باللغة العربية.',
  study_plan:
    'أنت مخطط أكاديمي في منصة TEMA. اقترح خطة مراجعة عملية ومختصرة باللغة العربية.',
};

export function createGeminiClient(apiKeyProvider: () => string | undefined): GeminiClient {
  return {
    async generateText({ prompt, task }) {
      const apiKey = apiKeyProvider()?.trim();
      if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY configuration on server.');
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

      return {
        text: (response.text ?? '').trim(),
        model,
      };
    },
  };
}
