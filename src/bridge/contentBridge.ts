import { BRIDGE_MAGIC, FIELD_MARKER_ATTR, PROFILE_SCORE_EMPTY_BELOW } from "~/config";
import { resolveAutoModeFromDom } from "~/auth/autoModeHeuristic";
import { createAutoModeWatcher, createDocumentTreeObserver, type AutoModeWatcher } from "~/auth/autoModeWatcher";
import type {
  AnswerCaptureRecord,
  AuthStatus,
  BackgroundResponse,
  ContentScriptRequest,
  ContentToBackground,
  FieldDescriptor,
  FieldResolveRequest,
  FieldResolveResult,
  FillDenialReason,
  MainWorldRequest,
  ProfileSummary,
  ResolvedOriginMode,
} from "./types";
import type { AtsName, ProfileValue } from "~/field/types";
import type { LearnedAnswerResult } from "~/resolver/learnedAnswers";
import { stageSubmittedAnswers } from "~/capture/captureStage";
import { fieldsWithoutProfileValue, mergeFillValues } from "./fillValues";
import { createGestureTracker } from "./trustedGesture";
import {
  closePicker,
  handlePickerAction,
  openFillConfirm,
  openPicker,
} from "~/ui/picker/pickerController";
import {
  FIELD_WIDGET_ATTR,
  FIELD_WIDGET_UUID_ATTR,
  fieldElementByUuid,
  findHostAnchor,
  widgetHostByUuid,
} from "~/ui/picker/fieldAnchor";
import type { PickerRelay } from "~/ui/picker/protocol";
import { browser } from "wxt/browser";
import { focusedFieldTarget } from "~/ui/picker/focusTarget";
import { whenDocumentVisible } from "~/core/visibility";
import { pageJobCountry } from "~/capture/pageJobCountry";

type Envelope<T> = {
  magic: typeof BRIDGE_MAGIC;
  from: "content" | "main";
  payload: T;
};

type FieldRequest = FieldResolveRequest & { requestId: string };

type Batch = { emit: boolean; valueRequests: number; expiresAt: number };

const MAIN_WORLD_READY_TIMEOUT_MS = 10_000;
const MAIN_WORLD_PING_INTERVAL_MS = 100;
const DESCRIBE_TIMEOUT_MS = 1_500;
const BATCH_TTL_MS = 5 * 60_000;
const MAX_VALUE_REQUESTS_PER_BATCH = 3;

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

const AUTO_MODE_DEBOUNCE_MS = 400;
const AUTO_MODE_SHADOW_POLL_MS = 2_000;

const afterPaint = async (): Promise<void> => {
  await whenDocumentVisible();
  return new Promise((resolve) => {
    if (document.readyState === "complete") {
      requestAnimationFrame(() => resolve());
    } else {
      window.addEventListener("load", () => requestAnimationFrame(() => resolve()), {
        once: true,
      });
    }
  });
};

let autoModeWatcher: AutoModeWatcher | null = null;

const autoModeVerdict = async (): Promise<ResolvedOriginMode> => {
  await afterPaint();
  if (!autoModeWatcher) {
    const tree = createDocumentTreeObserver(document, AUTO_MODE_SHADOW_POLL_MS);
    autoModeWatcher = createAutoModeWatcher({
      debounceMs: AUTO_MODE_DEBOUNCE_MS,
      evaluate: () => {
        try {
          return resolveAutoModeFromDom();
        } catch {
          return "notesOnly";
        }
      },
      observe: tree.observe,
      onUpgrade: () => {
        void sendToBackground({ kind: "mode.frameResolved", mode: "application" }).catch(() => {});
      },
    });
  }
  return autoModeWatcher.verdict();
};

const resolveFillValues = async (fields: FieldRequest[]) => {
  const profileRes = await sendToBackground<FieldResolveResult[]>({
    fields,
    kind: "resolveMany",
  });
  const profile = profileRes.ok && profileRes.data ? profileRes.data : [];
  const missing = fieldsWithoutProfileValue(fields, profile);
  let learned: LearnedAnswerResult[] = [];
  if (missing.length > 0) {
    const learnedRes = await sendToBackground<LearnedAnswerResult[]>({
      fields: missing,
      kind: "learnedAnswers.resolve",
    });
    learned = learnedRes.ok && learnedRes.data ? learnedRes.data : [];
  }
  return mergeFillValues(fields, profile, learned);
};

export const startContentBridge = (ats: AtsName): void => {
  if (bridgeStarted) return;
  bridgeStarted = true;

  const gate = createMainWorldGate();
  const gestures = createGestureTracker(window);
  const batches = new Map<string, Batch>();
  const describing = new Map<string, (d: FieldDescriptor | null) => void>();

  sendToBackground({
    ats,
    kind: "frame.register",
    url: window.location.href,
  }).catch(() => {});

  const liveBatch = (batchId: string): Batch | null => {
    const batch = batches.get(batchId);
    if (!batch) return null;
    if (Date.now() > batch.expiresAt) {
      batches.delete(batchId);
      return null;
    }
    return batch;
  };

  const startBatch = (
    batchId: string,
    emit: boolean,
    requestId: string | null,
    lowScore: boolean,
  ): void => {
    batches.set(batchId, {
      emit,
      expiresAt: Date.now() + BATCH_TTL_MS,
      valueRequests: 0,
    });
    gate.send({
      batchId,
      emit,
      id: crypto.randomUUID(),
      kind: "fill.run",
      lowScore,
      requestId,
    });
  };

  const describeField = (fieldUuid: string): Promise<FieldDescriptor | null> =>
    new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        describing.delete(id);
        resolve(null);
      }, DESCRIBE_TIMEOUT_MS);
      describing.set(id, (descriptor) => {
        window.clearTimeout(timer);
        describing.delete(id);
        resolve(descriptor && descriptor.fieldUuid === fieldUuid ? descriptor : null);
      });
      gate.send({ fieldUuid, id, kind: "field.describe" });
    });

  const openPickerFor = async (
    fieldUuid: string,
    anchorOverride: HTMLElement | null,
  ): Promise<void> => {
    const field = fieldElementByUuid(fieldUuid);
    if (!field) return;
    const anchor = anchorOverride ?? findHostAnchor(field) ?? field;
    const descriptor = await describeField(fieldUuid);
    if (!descriptor) return;
    openPicker({ anchor, descriptor, field, trigger: widgetHostByUuid(fieldUuid) });
  };

  const fillField = (fieldUuid: string, value: ProfileValue): void => {
    gate.send({ fieldUuid, id: crypto.randomUUID(), kind: "field.fill", value });
  };

  const denyFill = (requestId: string, reason: FillDenialReason): void =>
    sendFromContent({ id: crypto.randomUUID(), kind: "fill.denied", reason, requestId });

  const handleFillRequest = (requestId: string): void => {
    const click = gestures.consume("click");
    if (!click?.element || !click.element.isConnected) {
      denyFill(requestId, "untrusted");
      return;
    }
    openFillConfirm({
      anchor: click.element,
      onConfirm: () => void runConfirmedFill(requestId),
      onDismiss: () => denyFill(requestId, "dismissed"),
    });
  };

  const runConfirmedFill = async (requestId: string): Promise<void> => {
    const status = await sendToBackground<AuthStatus>({ kind: "auth.status" });
    if (!status.ok || !status.data?.authenticated) {
      await sendToBackground({ kind: "auth.openConnectPage" });
      denyFill(requestId, "signin");
      return;
    }
    const summary = await sendToBackground<ProfileSummary>({ kind: "profile.summary" });
    const lowScore =
      !summary.ok || !summary.data || summary.data.profileScore < PROFILE_SCORE_EMPTY_BELOW;
    startBatch(crypto.randomUUID(), false, requestId, lowScore);
  };

  const handleCapture = async (records: AnswerCaptureRecord[]): Promise<void> => {
    const gesture = gestures.consume("submit");
    if (!gesture) return;
    await stageSubmittedAnswers(sendToBackground, ats, gesture.form, records);
  };

  const relayFillEvent = async (msg: MainWorldRequest): Promise<void> => {
    if (!("batchId" in msg)) return;
    const batch = liveBatch(msg.batchId);
    if (!batch) return;
    if (msg.kind === "fill.result") batches.delete(msg.batchId);
    if (!batch.emit) return;
    if (msg.kind === "fill.started") {
      await sendToBackground({ batchId: msg.batchId, kind: "frame.fillStarted", pass: msg.pass, total: msg.total });
    } else if (msg.kind === "fill.progress") {
      await sendToBackground({
        batchId: msg.batchId,
        delta: msg.delta,
        kind: "frame.fillProgress",
        pass: msg.pass,
        totalDelta: msg.totalDelta,
      });
    } else if (msg.kind === "fill.totalIncreased") {
      await sendToBackground({
        addedTotal: msg.addedTotal,
        batchId: msg.batchId,
        kind: "frame.fillTotalIncreased",
        pass: msg.pass,
      });
    } else if (msg.kind === "fill.result") {
      await sendToBackground({ batchId: msg.batchId, counts: msg.counts, kind: "frame.fillResult", passes: msg.passes });
    }
  };

  const messageHandler = async (event: MessageEvent): Promise<void> => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!isFromMain(event.data)) return;

    const msg = event.data.payload;

    if (msg.kind === "mainWorld.ready") {
      gate.markReady();
      return;
    }

    if (msg.kind === "mode.get") {
      const res = await sendToBackground<ResolvedOriginMode>({ kind: "mode.get" });
      sendFromContent({
        id: msg.id,
        kind: "mode.result",
        mode: res.ok && res.data ? res.data : "notesOnly",
      });
      return;
    }

    if (msg.kind === "fill.fields") {
      const batch = liveBatch(msg.batchId);
      if (!batch || batch.valueRequests >= MAX_VALUE_REQUESTS_PER_BATCH) return;
      batch.valueRequests += 1;
      sendFromContent({
        batchId: msg.batchId,
        id: msg.id,
        kind: "fill.values",
        results: await resolveFillValues(msg.fields),
      });
      return;
    }

    if (
      msg.kind === "fill.started" ||
      msg.kind === "fill.progress" ||
      msg.kind === "fill.totalIncreased" ||
      msg.kind === "fill.result"
    ) {
      await relayFillEvent(msg);
      return;
    }

    if (msg.kind === "fill.request") {
      handleFillRequest(msg.id);
      return;
    }

    if (msg.kind === "widget.openDashboard") {
      if (gestures.consume("click")) {
        await sendToBackground({ kind: "auth.openDashboard" });
      }
      return;
    }

    if (msg.kind === "field.descriptor") {
      describing.get(msg.id)?.(msg.descriptor);
      return;
    }

    if (msg.kind === "capture.submit") {
      await handleCapture(msg.records);
    }

    if (msg.kind === "capture.draft" && msg.records.length > 0 && gestures.consume("edit")) {
      await sendToBackground({
        kind: "answers.saveDraft",
        payload: { applicationUrl: location.href, ats, records: msg.records },
      });
    }
  };

  window.addEventListener("message", (event) => {
    messageHandler(event).catch((e) => {
      console.error("[TP] contentBridge handler error", e);
    });
  });

  const onIconClick = (event: MouseEvent): void => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const host = event.target.closest<HTMLElement>(`[${FIELD_WIDGET_ATTR}]`);
    const fieldUuid = host?.getAttribute(FIELD_WIDGET_UUID_ATTR);
    if (!fieldUuid) return;
    void openPickerFor(fieldUuid, null);
  };
  window.addEventListener("click", onIconClick, true);

  const openPickerFromFocus = (): void => {
    const target = focusedFieldTarget();
    if (target) void openPickerFor(target.fieldUuid, target.focused);
  };

  const runtimeListener = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined => {
    if (!message || typeof message !== "object") return undefined;
    const m = message as {
      kind?: string;
      batchId?: string;
      mode?: ResolvedOriginMode;
    };
    if (m.kind === "page.jobCountry") {
      sendResponse(pageJobCountry(document));
      return undefined;
    }
    if (m.kind === "picker.relay") {
      const relay = message as PickerRelay;
      const response = handlePickerAction(relay.hostId, relay.activation, relay.action, fillField);
      if (response !== null) sendResponse(response);
      return undefined;
    }
    if (m.kind === "tab.fillAll" && typeof m.batchId === "string") {
      startBatch(m.batchId, true, null, false);
    }
    if (m.kind === "cmd.fillAll") {
      startBatch(crypto.randomUUID(), true, null, false);
    }
    if (m.kind === "cmd.openPicker") {
      openPickerFromFocus();
    }
    if (m.kind === "origin.disabled") {
      closePicker();
    }
    if (m.kind === "mode.changed" && m.mode) {
      gate.send({
        id: crypto.randomUUID(),
        kind: "mode.changed",
        mode: m.mode,
      });
    }
    if (m.kind === "mode.resolveAuto") {
      void (async () => {
        const mode = await autoModeVerdict();
        await sendToBackground({
          kind: "mode.frameResolved",
          mode,
        });
      })().catch((e) => {
        console.error("[TP] contentBridge mode.resolveAuto error", e);
      });
    }
    return undefined;
  };
  browser.runtime.onMessage.addListener(runtimeListener);

  window.addEventListener("pagehide", () => {
    autoModeWatcher?.stop();
    autoModeWatcher = null;
    gate.destroy();
    gestures.destroy();
    closePicker();
    window.removeEventListener("click", onIconClick, true);
    browser.runtime.onMessage.removeListener(runtimeListener);
  });
};
