import type { WechatMessage, WechatState } from './wechat.ts';

export interface ContactContext {
  chatId: string;
  /** User-authored background, never an inferred personality profile. */
  background: string;
  projectId: string | null;
  watching: boolean;
  version: number;
}
export interface WechatTopic {
  id: string;
  chatId: string;
  summary: string;
  title: string;
  opener: string;
  suggestions: string[];
  sources: WechatMessage[];
  fingerprint: string;
  createdAt: string;
  status: 'new' | 'opened' | 'dismissed';
  messageId?: string;
}
export interface ContactView {
  id: string;
  title: string;
  count: number;
  enabled: boolean;
  context: ContactContext;
  projectName?: string;
  topic?: WechatTopic;
  processing: boolean;
  error?: string;
}
export interface WechatPersonalState {
  contacts: ContactView[];
  capture: Pick<WechatState, 'enabled' | 'supported' | 'collector'>;
  projects: Array<{ id: string; name: string }>;
}
/** Synthetic incoming notification, kept separate from the scenario's project background. */
export interface WechatDemoSource {
  id: string;
  sender: string;
  text: string;
  /** ISO timestamp with an explicit timezone. */
  timestamp: string;
}
export interface WechatDemoScenario {
  id: string;
  name: string;
  subtitle: string;
  contact: string;
  background: string;
  project: string;
  memory: string;
  sources: WechatDemoSource[];
  /** Short preview retained for older demo clients; sources contain the original notifications. */
  message: string;
  summary: string;
  title: string;
  opener: string;
  choices: Array<{ label: string; answer: string; result: string }>;
}
export interface WechatDemoState {
  active: boolean;
  scenarioId: string;
  received: boolean;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
  result?: string;
}
