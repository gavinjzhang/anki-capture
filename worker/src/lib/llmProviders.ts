export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek';

export interface ProviderConfig {
  name: string;
  models: string[];
  keyHint: string;
  keyPattern: RegExp;
}

export const LLM_PROVIDERS: Record<LLMProvider, ProviderConfig> = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
    keyHint: 'sk-...',
    keyPattern: /^sk-[A-Za-z0-9_-]{20,200}$/,
  },
  anthropic: {
    name: 'Anthropic',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    keyHint: 'sk-ant-...',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,200}$/,
  },
  gemini: {
    name: 'Google Gemini',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
    keyHint: 'AIza...',
    keyPattern: /^AIza[A-Za-z0-9_-]{30,60}$/,
  },
  deepseek: {
    name: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyHint: 'sk-...',
    keyPattern: /^sk-[A-Za-z0-9]{20,200}$/,
  },
};

export const PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as LLMProvider[];
