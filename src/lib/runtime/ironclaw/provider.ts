import type {
  EventFrame,
  GatewayConnectOptions,
  GatewayGapInfo,
  GatewayStatus,
} from "@/lib/gateway/GatewayClient";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { buildAgentMainSessionKey } from "@/lib/gateway/GatewayClient";
import {
  buildAgentHandoffInstruction,
  buildDirectedAgentMessageInstruction,
} from "@/lib/runtime/agentMessaging";
import {
  fetchCustomRuntimeJson,
  normalizeCustomBaseUrl,
  requestCustomRuntime,
} from "@/lib/runtime/custom/http";
import type { RuntimeCapability, RuntimeEvent, RuntimeProvider } from "@/lib/runtime/types";

const IRONCLAW_AGENT_ID = "ironclaw";
const IRONCLAW_MAIN_KEY = "main";
const IRONCLAW_SESSION_KEY = buildAgentMainSessionKey(IRONCLAW_AGENT_ID, IRONCLAW_MAIN_KEY);
const IRONCLAW_CHAT_COMPLETION_TIMEOUT_MS = 60_000;
const IRONCLAW_RUNTIME_CAPABILITIES: ReadonlySet<RuntimeCapability> = new Set([
  "agents",
  "sessions",
  "chat",
  "agent-messages",
  "agent-handoffs",
  "models",
  "agent-roles",
]);

type IronClawGatewayStatusResponse = {
  version?: string | null;
  llm_backend?: string | null;
  llm_model?: string | null;
  enabled_channels?: string[] | null;
};

type IronClawThread = {
  id?: string | null;
  state?: string | null;
  turn_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  title?: string | null;
  thread_type?: string | null;
  channel?: string | null;
};

type IronClawThreadsResponse = {
  assistant_thread?: IronClawThread | null;
  active_thread?: IronClawThread | null;
  threads?: IronClawThread[] | null;
};

type IronClawHistoryTurn = {
  turn_number?: number | null;
  user_input?: string | null;
  response?: string | null;
  state?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

type IronClawHistoryResponse = {
  thread_id?: string | null;
  turns?: IronClawHistoryTurn[] | null;
  has_more?: boolean;
};

type IronClawThreadCreateResponse = {
  id?: string | null;
  updated_at?: string | null;
  title?: string | null;
  channel?: string | null;
  thread_type?: string | null;
};

type IronClawChatSendResponse = {
  message_id?: string | null;
  status?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const coerceString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toTimestampMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const normalizeThread = (value: IronClawThread | IronClawThreadCreateResponse | null | undefined) => {
  if (!isRecord(value)) return null;
  const record = value as Record<string, unknown>;
  const id = coerceString(record.id);
  if (!id) return null;
  return {
    id,
    state: coerceString(record.state),
    updatedAt: toTimestampMs(record.updated_at) ?? toTimestampMs(record.created_at),
    title: coerceString(record.title),
    threadType: coerceString(record.thread_type),
    channel: coerceString(record.channel),
  };
};

const normalizeTurns = (turns: IronClawHistoryTurn[] | null | undefined) =>
  Array.isArray(turns)
    ? turns.map((turn) => ({
        turnNumber:
          typeof turn.turn_number === "number" && Number.isFinite(turn.turn_number)
            ? turn.turn_number
            : null,
        userInput: coerceString(turn.user_input),
        response: coerceString(turn.response),
        state: coerceString(turn.state),
        startedAt: toTimestampMs(turn.started_at),
        completedAt: toTimestampMs(turn.completed_at),
      }))
    : [];

const buildPreviewItems = (
  turns: ReturnType<typeof normalizeTurns>,
  limit: number
) =>
  turns.slice(-Math.max(1, limit)).flatMap((turn) => {
    const items: Array<{ role: "user" | "assistant"; text: string; timestamp?: number }> = [];
    if (turn.userInput) {
      items.push({
        role: "user",
        text: turn.userInput,
        ...(turn.startedAt ? { timestamp: turn.startedAt } : {}),
      });
    }
    if (turn.response) {
      items.push({
        role: "assistant",
        text: turn.response,
        ...(turn.completedAt ? { timestamp: turn.completedAt } : {}),
      });
    }
    return items;
  });

const buildHistoryMessages = (turns: ReturnType<typeof normalizeTurns>) =>
  turns.flatMap((turn) => {
    const messages: Array<Record<string, unknown>> = [];
    if (turn.userInput) {
      messages.push({
        role: "user",
        content: turn.userInput,
        ...(turn.startedAt ? { timestamp: turn.startedAt } : {}),
      });
    }
    if (turn.response) {
      messages.push({
        role: "assistant",
        content: turn.response,
        ...(turn.completedAt ? { timestamp: turn.completedAt } : {}),
      });
    }
    return messages;
  });

const isGatewayThread = (thread: ReturnType<typeof normalizeThread>) =>
  Boolean(thread && thread.channel.toLowerCase() === "gateway");

const resolveLocalTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export class IronClawRuntimeProvider implements RuntimeProvider {
  readonly id = "ironclaw" as const;
  readonly label = "IronClaw";
  readonly metadata = {
    id: this.id,
    label: this.label,
    runtimeName: "IronClaw",
    vendor: "IronClaw",
    routeProfile: "ironclaw",
  } as const;
  readonly capabilities = IRONCLAW_RUNTIME_CAPABILITIES;
  private readonly baseUrl: string;
  private readonly runtimeToken: string;
  private mainThreadIdOverride: string | null = null;

  constructor(readonly client: GatewayClient, runtimeUrl: string, runtimeToken = "") {
    this.baseUrl = normalizeCustomBaseUrl(runtimeUrl);
    this.runtimeToken = runtimeToken.trim();
    try {
      const parsed = new URL(runtimeUrl);
      if (!this.runtimeToken) {
        this.runtimeToken = parsed.searchParams.get("token")?.trim() ?? "";
      }
    } catch {
      // Ignore invalid URLs here; user-facing validation happens during connect.
    }
  }

  connect(options: GatewayConnectOptions): Promise<void> {
    return this.client.connect(options);
  }

  disconnect(): void {
    this.client.disconnect();
  }

  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    switch (method) {
      case "agents.list":
        return (await this.callAgentsList()) as T;
      case "sessions.list":
        return (await this.callSessionsList(params)) as T;
      case "status":
        return (await this.callStatus()) as T;
      case "models.list":
        return (await this.callModelsList()) as T;
      case "sessions.preview":
        return (await this.callSessionsPreview(params)) as T;
      case "chat.history":
        return (await this.callChatHistory(params)) as T;
      case "chat.send":
        return (await this.callChatSend(params)) as T;
      case "agents.message":
        return (await this.callAgentsMessage(params)) as T;
      case "agents.handoff":
        return (await this.callAgentsHandoff(params)) as T;
      case "chat.abort":
        return ({ ok: true } as T);
      case "sessions.reset":
        return (await this.callSessionsReset(params)) as T;
      case "agent.wait":
        return ({ status: "done" } as T);
      case "exec.approvals.get":
        return ({ file: { agents: {} } } as T);
      case "config.get":
      case "config.patch":
      case "config.set":
        throw new Error(`IronClaw does not support ${method}.`);
      default:
        throw new Error(`IronClaw does not implement ${method}.`);
    }
  }

  getLastHello() {
    return this.client.getLastHello();
  }

  onStatus(handler: (status: GatewayStatus) => void): () => void {
    return this.client.onStatus(handler);
  }

  onGap(handler: (info: GatewayGapInfo) => void): () => void {
    return this.client.onGap(handler);
  }

  onEvent(handler: (event: EventFrame) => void): () => void {
    return this.client.onEvent(handler);
  }

  onRuntimeEvent(_handler: (event: RuntimeEvent) => void): () => void {
    return () => {};
  }

  private async fetchJson<T>(pathname: string): Promise<T> {
    return fetchCustomRuntimeJson<T>(this.baseUrl, pathname, this.runtimeToken, this.id);
  }

  private async request<T>(pathname: string, body: unknown): Promise<T> {
    return requestCustomRuntime<T>({
      runtimeUrl: this.baseUrl,
      runtimeToken: this.runtimeToken,
      runtimeAdapterType: this.id,
      pathname,
      method: "POST",
      body,
    });
  }

  private async fetchStatus() {
    return this.fetchJson<IronClawGatewayStatusResponse>("/api/gateway/status");
  }

  private async fetchThreads() {
    return this.fetchJson<IronClawThreadsResponse>("/api/chat/threads");
  }

  private async fetchHistory(threadId: string, limit = 20) {
    const encodedThreadId = encodeURIComponent(threadId);
    return this.fetchJson<IronClawHistoryResponse>(
      `/api/chat/history?thread_id=${encodedThreadId}&limit=${Math.max(1, limit)}`
    );
  }

  private async createThread() {
    return normalizeThread(
      await this.request<IronClawThreadCreateResponse>("/api/chat/thread/new", {})
    );
  }

  private async resolveMainThread() {
    const threads = await this.fetchThreads();
    const candidates = [
      normalizeThread(threads.assistant_thread ?? null),
      normalizeThread(threads.active_thread ?? null),
      ...(Array.isArray(threads.threads) ? threads.threads.map((thread) => normalizeThread(thread)) : []),
    ].filter((thread): thread is NonNullable<ReturnType<typeof normalizeThread>> => Boolean(thread));

    if (this.mainThreadIdOverride) {
      const overridden = candidates.find((thread) => thread.id === this.mainThreadIdOverride) ?? null;
      if (overridden) {
        return overridden;
      }
      this.mainThreadIdOverride = null;
    }

    const resolved =
      candidates.find((thread) => isGatewayThread(thread)) ??
      candidates[0] ??
      (await this.createThread());

    if (!resolved) {
      throw new Error("IronClaw did not return a usable chat thread.");
    }
    return resolved;
  }

  private async waitForCompletedTurn(threadId: string, baselineTurnCount: number) {
    const deadline = Date.now() + IRONCLAW_CHAT_COMPLETION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const history = await this.fetchHistory(threadId, 50);
      const turns = normalizeTurns(history.turns);
      const candidate = turns.find(
        (turn, index) =>
          index >= baselineTurnCount &&
          turn.state.toLowerCase() === "completed" &&
          turn.response.length > 0
      );
      if (candidate) {
        return candidate;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 350);
      });
    }
    return null;
  }

  private assertSupportedSessionKey(rawSessionKey: unknown) {
    const sessionKey = coerceString(rawSessionKey);
    if (!sessionKey) {
      throw new Error("IronClaw requires sessionKey.");
    }
    if (sessionKey !== IRONCLAW_SESSION_KEY) {
      throw new Error("IronClaw currently supports the main session only.");
    }
    return sessionKey;
  }

  private async callAgentsList() {
    return {
      defaultId: IRONCLAW_AGENT_ID,
      mainKey: IRONCLAW_MAIN_KEY,
      scope: "ironclaw",
      agents: [
        {
          id: IRONCLAW_AGENT_ID,
          name: "IronClaw",
          identity: { name: "IronClaw" },
        },
      ],
    };
  }

  private async callSessionsList(rawParams: unknown) {
    const params = isRecord(rawParams) ? rawParams : {};
    const requestedAgentId = coerceString(params.agentId);
    const search = coerceString(params.search);
    if (requestedAgentId && requestedAgentId !== IRONCLAW_AGENT_ID) {
      return { sessions: [] };
    }

    const [thread, status] = await Promise.all([
      this.resolveMainThread(),
      this.fetchStatus().catch(() => null),
    ]);

    if (search && search !== IRONCLAW_SESSION_KEY) {
      return { sessions: [] };
    }

    return {
      sessions: [
        {
          key: IRONCLAW_SESSION_KEY,
          updatedAt: thread.updatedAt,
          displayName: thread.title || "IronClaw",
          origin: {
            label: "IronClaw",
            provider: "ironclaw",
          },
          modelProvider: coerceString(status?.llm_backend) || "ironclaw",
          model: coerceString(status?.llm_model) || null,
        },
      ],
    };
  }

  private async callStatus() {
    const thread = await this.resolveMainThread();
    return {
      sessions: {
        recent: [
          {
            key: IRONCLAW_SESSION_KEY,
            updatedAt: thread.updatedAt,
          },
        ],
        byAgent: [
          {
            agentId: IRONCLAW_AGENT_ID,
            recent: [
              {
                key: IRONCLAW_SESSION_KEY,
                updatedAt: thread.updatedAt,
              },
            ],
          },
        ],
      },
    };
  }

  private async callModelsList() {
    const status = await this.fetchStatus();
    const modelId = coerceString(status.llm_model);
    const provider = coerceString(status.llm_backend) || "ironclaw";
    return {
      models: modelId
        ? [
            {
              id: modelId,
              name: modelId,
              provider,
            },
          ]
        : [],
    };
  }

  private async callSessionsPreview(rawParams: unknown) {
    const params = isRecord(rawParams) ? rawParams : {};
    const keys = Array.isArray(params.keys)
      ? params.keys.filter((value): value is string => typeof value === "string")
      : [];
    const thread = await this.resolveMainThread();
    const history = await this.fetchHistory(thread.id, 8);
    const items = buildPreviewItems(normalizeTurns(history.turns), 8);
    return {
      ts: Date.now(),
      previews: keys.map((key) => ({
        key,
        status: key === IRONCLAW_SESSION_KEY ? (items.length > 0 ? "ok" : "empty") : "missing",
        items: key === IRONCLAW_SESSION_KEY ? items : [],
      })),
    };
  }

  private async callChatHistory(rawParams: unknown) {
    const params = isRecord(rawParams) ? rawParams : {};
    const sessionKey = this.assertSupportedSessionKey(params.sessionKey);
    const thread = await this.resolveMainThread();
    const history = await this.fetchHistory(thread.id, 50);
    return {
      sessionKey,
      messages: buildHistoryMessages(normalizeTurns(history.turns)),
    };
  }

  private async callChatSend(rawParams: unknown) {
    const params = isRecord(rawParams) ? rawParams : {};
    this.assertSupportedSessionKey(params.sessionKey);
    const message = coerceString(params.message);
    const runId = coerceString(params.idempotencyKey);
    if (!message) {
      throw new Error("IronClaw requires a message for chat.send.");
    }

    const thread = await this.resolveMainThread();
    const historyBefore = await this.fetchHistory(thread.id, 50);
    const baselineTurnCount = normalizeTurns(historyBefore.turns).length;
    const sendResult = await this.request<IronClawChatSendResponse>("/api/chat/send", {
      content: message,
      thread_id: thread.id,
      timezone: resolveLocalTimezone(),
    });
    const completedTurn = await this.waitForCompletedTurn(thread.id, baselineTurnCount);

    if (!completedTurn?.response) {
      throw new Error(
        `IronClaw accepted the message but did not return a completed response within ${IRONCLAW_CHAT_COMPLETION_TIMEOUT_MS / 1000} seconds.`
      );
    }

    return {
      status: "completed",
      runId: runId || coerceString(sendResult.message_id) || null,
      text: completedTurn.response,
    };
  }

  private async callAgentsMessage(rawParams: unknown) {
    const params = isRecord(rawParams) ? rawParams : {};
    return this.callChatSend({
      sessionKey: IRONCLAW_SESSION_KEY,
      message: buildDirectedAgentMessageInstruction({
        targetAgentId: coerceString(params.targetAgentId) || IRONCLAW_AGENT_ID,
        message: coerceString(params.message),
        sourceAgentId: coerceString(params.sourceAgentId),
        sourceLabel: coerceString(params.sourceLabel),
        mode:
          params.mode === "interval" || params.mode === "direct" ? params.mode : "direct",
        cadenceHint: coerceString(params.cadenceHint),
      }),
      idempotencyKey: coerceString(params.idempotencyKey) || undefined,
    });
  }

  private async callAgentsHandoff(rawParams: unknown) {
    const params = isRecord(rawParams) ? rawParams : {};
    return this.callChatSend({
      sessionKey: IRONCLAW_SESSION_KEY,
      message: buildAgentHandoffInstruction({
        targetAgentId: coerceString(params.targetAgentId) || IRONCLAW_AGENT_ID,
        task: coerceString(params.task),
        sourceAgentId: coerceString(params.sourceAgentId),
        sourceLabel: coerceString(params.sourceLabel),
        context: coerceString(params.context),
        acceptanceCriteria: coerceString(params.acceptanceCriteria),
        deliverables: Array.isArray(params.deliverables)
          ? params.deliverables.filter((entry): entry is string => typeof entry === "string")
          : [],
      }),
      idempotencyKey: coerceString(params.idempotencyKey) || undefined,
    });
  }

  private async callSessionsReset(rawParams: unknown) {
    const params = isRecord(rawParams) ? rawParams : {};
    this.assertSupportedSessionKey(params.key);
    const thread = await this.createThread();
    this.mainThreadIdOverride = thread?.id ?? null;
    return { ok: true };
  }
}