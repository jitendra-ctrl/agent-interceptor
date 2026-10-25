export interface ActionCall {
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface Turn {
  utterance: string;
  reply: string;
  planId: string | null;
  /** Actions the runtime executed for this turn, from the session trace (not from the reply). */
  actions: ActionCall[];
}

export interface Conversation {
  driver: string;
  mode: 'live' | 'simulated';
  sessionId: string;
  turns: Turn[];
  tracesPath: string | null;
}

/** Talks to the agent. Implementations: sf agent preview (default); the Agent API could be added. */
export interface ConversationDriver {
  readonly name: string;
  converse(utterances: string[], timeoutSeconds: number): Promise<Conversation>;
}
