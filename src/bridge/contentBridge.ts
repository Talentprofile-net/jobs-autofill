import { BRIDGE_MAGIC } from "~/config";
import { resolveAutoModeFromDom } from "~/auth/autoModeHeuristic";
import type {
  AnswerCaptureRecord,
  AuthStatus,
  BackgroundResponse,
  ContentScriptRequest,
  ContentToBackground,
  FieldResolveResult,
  MainWorldRequest,
  ProfileSummary,
  ResolvedOriginMode,
} from "./types";
import type { AtsName } from "~/field/types";
import type { Profile, ProfileNote } from "~/api/types";
import type { ProfileValue } from "~/field/types";
import type { Suggestion } from "~/classifier/suggest";
import { requestSuggestionRow } from "~/classifier/suggestClient";
import { browser } from "wxt/browser";

type Envelope<T> = {
  magic: typeof BRIDGE_MAGIC;
  from: "content" | "main";
  payload: T;
};

const MAIN_WORLD_READY_TIMEOUT_MS = 10_000;
const MAIN_WORLD_PING_INTERVAL_MS = 100;

const sendFromContent = (payload: ContentScriptRequest): void => {
  const envelope: Envelope<ContentScriptRequest> = {
    from: "content",
    magic: BRIDGE_MAGIC,
    payload,
  };
  window.postMessage(envelope, window.location.origin);
};

const isFromMain = (data: unknown): data is Envelope<MainWorldRequest> => {
  if (!data || typeof data !== "object") return false;
  const env = data as Envelope<MainWorldRequest>;
  return env.magic === BRIDGE_MAGIC && env.from === "main";
};

const sendToBackground = async <T = unknown>(
  message: ContentToBackground,
): Promise<BackgroundResponse<T>> => {
  try {
    const res = (await browser.runtime.sendMessage(
      message,
    )) as BackgroundResponse<T>;
    return res ?? { error: "no response", ok: false };
  } catch (e) {
    return { error: (e as Error).message, ok: false };
  }
};

type MainWorldGate = {
  send: (msg: ContentScriptRequest) => void;
  markReady: () => void;
  destroy: () => void;
};

const createMainWorldGate = (): MainWorldGate => {
  let ready = false;
  let destroyed = false;
  const queue: ContentScriptRequest[] = [];

  const flushQueue = (): void => {
    while (queue.length > 0) {
      const msg = queue.shift();
      if (msg) sendFromContent(msg);
    }
  };

  const send = (msg: ContentScriptRequest): void => {
    if (destroyed) return;
    if (ready) {
      sendFromContent(msg);
    } else {
      queue.push(msg);
    }
  };

  const markReady = (): void => {
    if (ready) return;
    ready = true;
    flushQueue();
  };

  let elapsed = 0;
  let interval = MAIN_WORLD_PING_INTERVAL_MS;
  let pingTimer: number | null = null;

  const scheduleNextPing = () => {
    if (destroyed || ready) return;
    if (elapsed >= MAIN_WORLD_READY_TIMEOUT_MS) {
      console.warn("[TP] main-world failed to load within timeout");
      queue.length = 0;
      return;
    }
    pingTimer = window.setTimeout(() => {
      if (destroyed || ready) return;
      sendFromContent({ id: crypto.randomUUID(), kind: "mainWorld.ping" });
      elapsed += interval;
      interval = Math.min(interval * 2, 1000);
      scheduleNextPing();
    }, interval);
  };
  scheduleNextPing();

  return {
    destroy: () => {
      destroyed = true;
      if (pingTimer !== null) window.clearTimeout(pingTimer);
      queue.length = 0;
    },
    markReady,
    send,
  };
};

let bridgeStarted = false;

const computeAutoModeAfterPaint = (): Promise<ResolvedOriginMode> =>
  new Promise((resolve) => {
    const compute = () => {
      try {
        resolve(resolveAutoModeFromDom());
      } catch {
        resolve("notesOnly");
      }
    };
    if (document.readyState === "complete") {
      requestAnimationFrame(compute);
    } else {
      window.addEventListener("load", () => requestAnimationFrame(compute), {
        once: true,
      });
    }
  });

export const startContentBridge = (ats: AtsName): void => {
  if (bridgeStarted) return;
  bridgeStarted = true;

  const gate = createMainWorldGate();

  sendToBackground({
    ats,
    kind: "frame.register",
    url: window.location.href,
  }).catch(() => {});

  const messageHandler = async (event: MessageEvent): Promise<void> => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!isFromMain(event.data)) return;

    const msg = event.data.payload;

    if (msg.kind === "mainWorld.ready") {
      gate.markReady();
      return;
    }

    if (msg.kind === "resolveFieldValue") {
      const res = await sendToBackground<{
        value: ProfileValue;
        profileField: string | null;
      }>({
        fieldName: msg.fieldName,
        fieldType: msg.fieldType,
        kind: "resolve",
        section: msg.section,
      });
      const value: ProfileValue =
        res.ok && res.data ? res.data.value : { kind: "unsupported" };
      const profileField: string | null =
        res.ok && res.data ? res.data.profileField : null;
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "fieldValueResult",
        profileField,
        value,
      });
      return;
    }

    if (msg.kind === "resolveFieldValues") {
      const res = await sendToBackground<FieldResolveResult[]>({
        fields: msg.fields,
        kind: "resolveMany",
      });
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "fieldValuesResult",
        values: res.ok && res.data ? res.data : [],
      });
      return;
    }

    if (msg.kind === "classifier.suggest") {
      sendFromContent({
        id: msg.id,
        kind: "classifier.suggestResult",
        row: await requestSuggestionRow(
          (message) => sendToBackground<Suggestion>(message),
          browser.storage.local,
          msg.request,
        ),
      });
      return;
    }

    if (msg.kind === "resolveLearnedAnswers") {
      const res = await sendToBackground<
        Array<{
          requestId: string;
          value: ProfileValue;
          matchedAnswerId: string | null;
        }>
      >({
        fields: msg.fields,
        kind: "learnedAnswers.resolve",
      });
      sendFromContent({
        id: msg.id,
        kind: "learnedAnswersResult",
        results: res.ok && res.data ? res.data : [],
      });
      return;
    }

    if (msg.kind === "tab.fillStarted") {
      await sendToBackground({
        batchId: msg.batchId,
        kind: "frame.fillStarted",
        pass: msg.pass,
        total: msg.total,
      });
      return;
    }

    if (msg.kind === "tab.fillProgress") {
      await sendToBackground({
        batchId: msg.batchId,
        delta: msg.delta,
        kind: "frame.fillProgress",
        pass: msg.pass,
        totalDelta: msg.totalDelta,
      });
      return;
    }

    if (msg.kind === "tab.fillTotalIncreased") {
      await sendToBackground({
        addedTotal: msg.addedTotal,
        batchId: msg.batchId,
        kind: "frame.fillTotalIncreased",
        pass: msg.pass,
      });
      return;
    }

    if (msg.kind === "tab.fillAllResult") {
      await sendToBackground({
        batchId: msg.batchId,
        counts: msg.counts,
        kind: "frame.fillResult",
        passes: msg.passes,
      });
      return;
    }

    if (msg.kind === "answers.stage") {
      const res = await sendToBackground<{ stageId: string }>({
        kind: "answers.stage",
        payload: msg.payload,
      });
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "answers.stageResult",
        ok: res.ok,
        stageId: res.ok ? res.data?.stageId : undefined,
      });
      return;
    }

    if (msg.kind === "answers.commit") {
      const res = await sendToBackground({
        kind: "answers.commit",
        stageId: msg.stageId,
      });
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "answers.commitResult",
        ok: res.ok,
      });
      return;
    }

    if (msg.kind === "answers.discard") {
      const res = await sendToBackground({
        kind: "answers.discard",
        outcome: msg.outcome,
        stageId: msg.stageId,
      });
      sendFromContent({
        id: msg.id,
        kind: "answers.discardResult",
        ok: res.ok,
      });
      return;
    }

    if (msg.kind === "auth.requestSignIn") {
      await sendToBackground({ kind: "auth.openConnectPage" });
      return;
    }

    if (msg.kind === "auth.openDashboard") {
      await sendToBackground({ kind: "auth.openDashboard" });
      return;
    }

    if (msg.kind === "auth.getStatus") {
      const res = await sendToBackground<AuthStatus>({ kind: "auth.status" });
      sendFromContent({
        id: msg.id,
        kind: "auth.statusResult",
        status:
          res.ok && res.data
            ? res.data
            : { authenticated: false, reason: "network-error" },
      });
      return;
    }

    if (msg.kind === "auth.getSummary") {
      const res = await sendToBackground<ProfileSummary>({
        kind: "profile.summary",
      });
      sendFromContent({
        id: msg.id,
        kind: "auth.summaryResult",
        summary: res.ok && res.data ? res.data : null,
      });
      return;
    }

    if (msg.kind === "auth.getProfile") {
      const res = await sendToBackground<Profile>({
        kind: "profile.get",
      });
      sendFromContent({
        id: msg.id,
        kind: "auth.profileResult",
        profile: res.ok && res.data ? res.data : null,
      });
      return;
    }

    if (msg.kind === "note.create") {
      const res = await sendToBackground<ProfileNote>({
        content: msg.content,
        kind: "note.create",
      });
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "note.createResult",
        note: res.ok && res.data ? res.data : null,
      });
      return;
    }

    if (msg.kind === "note.update") {
      const res = await sendToBackground<ProfileNote>({
        content: msg.content,
        kind: "note.update",
        noteId: msg.noteId,
      });
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "note.updateResult",
        note: res.ok && res.data ? res.data : null,
      });
      return;
    }

    if (msg.kind === "note.delete") {
      const res = await sendToBackground<{ id: string }>({
        kind: "note.delete",
        noteId: msg.noteId,
      });
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "note.deleteResult",
        noteId: res.ok ? msg.noteId : null,
      });
      return;
    }

    if (msg.kind === "note.touch") {
      const res = await sendToBackground({
        kind: "note.touch",
        noteId: msg.noteId,
      });
      sendFromContent({
        error: res.ok ? undefined : res.error,
        id: msg.id,
        kind: "note.touchResult",
        ok: res.ok,
      });
      return;
    }

    if (msg.kind === "mode.get") {
      const res = await sendToBackground<ResolvedOriginMode>({
        kind: "mode.get",
      });
      sendFromContent({
        id: msg.id,
        kind: "mode.result",
        mode: res.ok && res.data ? res.data : "notesOnly",
      });
      return;
    }
  };

  window.addEventListener("message", (event) => {
    messageHandler(event).catch((e) => {
      console.error("[TP] contentBridge handler error", e);
    });
  });

  const runtimeListener = (message: unknown): void => {
    if (!message || typeof message !== "object") return;
    const m = message as {
      kind?: string;
      batchId?: string;
      mode?: ResolvedOriginMode;
    };
    if (m.kind === "tab.fillAll" && typeof m.batchId === "string") {
      const id = crypto.randomUUID();
      gate.send({ batchId: m.batchId, id, kind: "tab.fillAll" });
    }
    if (m.kind === "auth.changed") {
      (async () => {
        const res = await sendToBackground<AuthStatus>({ kind: "auth.status" });
        const status: AuthStatus =
          res.ok && res.data
            ? res.data
            : { authenticated: false, reason: "network-error" };
        gate.send({
          id: crypto.randomUUID(),
          kind: "auth.statePushed",
          status,
        });
      })().catch((e) => {
        console.error("[TP] contentBridge auth push error", e);
      });
    }
    if (m.kind === "mode.changed" && m.mode) {
      gate.send({
        id: crypto.randomUUID(),
        kind: "mode.changed",
        mode: m.mode,
      });
    }
    if (m.kind === "mode.resolveAuto") {
      gate.send({ id: crypto.randomUUID(), kind: "mode.resolveAuto" });
      void (async () => {
        const mode = await computeAutoModeAfterPaint();
        await sendToBackground({
          kind: "mode.frameResolved",
          mode,
        });
      })().catch((e) => {
        console.error("[TP] contentBridge mode.resolveAuto error", e);
      });
    }
    if (m.kind === "cmd.openPicker") {
      gate.send({ id: crypto.randomUUID(), kind: "cmd.openPicker" });
    }
    if (m.kind === "cmd.fillAll") {
      gate.send({ id: crypto.randomUUID(), kind: "cmd.fillAllHotkey" });
    }
  };
  browser.runtime.onMessage.addListener(runtimeListener);

  window.addEventListener("pagehide", () => {
    gate.destroy();
    browser.runtime.onMessage.removeListener(runtimeListener);
  });
};