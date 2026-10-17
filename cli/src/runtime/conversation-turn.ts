/** Supplied by the trusted input adapter, never accepted from a page routing hint. */
export interface ConversationTurnSource {
  turnId: string;
  sessionId: string;
  surface: 'chat' | 'view' | 'invoked_voice';
  text: string;
  revision: number;
  consentRef: string;
  context?: Array<{ ref: string; text: string }>;
  final: true;
  retention: 'local_default';
}
