import { defineBackground } from "wxt/utils/define-background";
import { apiFetch, ApiError, AuthError, NetworkError } from "~/api/client";
import { fetchMyProfile } from "~/api/profile";
import { refreshAccessToken } from "~/api/client";
import { clearTokens, getTokens, setTokens } from "~/auth/tokenStorage";
import { isExpired, extractEmail } from "~/auth/jwt";
import {
  addEnabledOrigin,
  dynamicScriptIds,
  getEnabledOrigins,
  getEnabledPatterns,
  getOriginMode,
  normalizeOriginPattern,
  originFromPattern,
  removeEnabledOrigin,
  setEnabledOrigins,
  updateEnabledOriginMode,
} from "~/auth/enabledOrigins";
import {
  clearConnectAttempt,
  getConnectAttempt,
  setConnectAttempt,
  type ConnectAttempt,
} from "~/auth/connectAttempt";
import { resolveField } from "~/resolver/profileResolver";
import { calculateProfileScore } from "~/resolver/profileScore";
import {
  EXTENSION_CONNECT_PATH,
  PROFILE_CACHE_TTL_MS,
  WEB_APP_DASHBOARD_URL,
} from "~/config";
import { detectAts as detectAtsHost } from "~/core/ats";
import type {
  AuthStatus,
  BackgroundResponse,
  ContentToBackground,
  EnabledOriginEntry,
  ExternalToBackground,
  FillBatchError,
  FillBatchErrorKind,
  FillBatchResult,
  FillCounts,
  FillPortIncoming,
  FillPortOutgoing,
  PopupToBackground,
  ProfileSummary,
  ResolvedOriginMode,
  TabOriginInfo,
} from "~/bridge/types";
import type { Profile, ProfileNote } from "~/api/types";
import type { AtsName, OriginMode, ProfileValue } from "~/field/types";
import { browser } from "wxt/browser";

const FRAME_REGISTRY_KEY = "tp.frameRegistry";
const PROFILE_CACHE_KEY = "tp.profileCache";
const MAIN_WORLD_SCRIPT_PATH = "/main-world.js";
const CONTENT_SCRIPT_PATH = "/content-scripts/content.js";

const STATIC_HOST_PATTERNS = [
  "https://*.myworkdayjobs.com/*",
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
];

const buildConnectUrl = (): string => {
  const base = WEB_APP_DASHBOARD_URL.replace(/\/+$/, "");
  const path = EXTENSION_CONNECT_PATH.startsWith("/")
    ? EXTENSION_CONNECT_PATH
    : `/${EXTENSION_CONNECT_PATH}`;
  return `${base}${path}`;
};

const patternToRegex = (pattern: string): RegExp | null => {
  const match = /^(https?):\/\/([^/]+)\/\*$/.exec(pattern);
  if (!match) return null;
  const scheme = match[1];
  const host = match[2];
  const hostRegex = host
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, "[^/]*");
  return new RegExp(`^${scheme}://${hostRegex}(/.*)?$`);
};

const urlMatchesPatternOrigin = (url: string, pattern: string): boolean => {
  const patternOrigin = originFromPattern(pattern);
  if (!patternOrigin) return false;
  try {
    const u = new URL(url);
    return u.origin === patternOrigin;
  } catch {
    return false;
  }
};

type FrameRecord = { frameId: number; ats: AtsName };
type FrameRegistry = Record<number, FrameRecord[]>;

type FramePending = {
  frameId: number;
  timer: ReturnType<typeof setTimeout>;
};

type PendingFillBatch = {
  batchId: string;
  tabId: number;
  expectedFrames: number;
  receivedFrames: number;
  framesTimedOut: number;
  framesFailedDelivery: number;
  framePending: Map<number, FramePending>;
  framesReported: Set<number>;
  counts: FillCounts;
  resolve: (result: FillBatchResult) => void;
  globalTimer: ReturnType<typeof setTimeout> | null;
  finalized: boolean;
  totalByFrame: Map<number, number>;
  maxPasses: number;
  batchError?: FillBatchError;
};

const FILL_GLOBAL_TIMEOUT_MS = 25_000;
const FILL_PER_FRAME_TIMEOUT_MS = 15_000;

const FRAME_AUTO_MODE_TTL_MS = 60_000;
const FRAME_AUTO_MODE_REQUEST_TIMEOUT_MS = 1_500;

type FrameAutoModeCacheEntry = {
  mode: ResolvedOriginMode;
  resolvedAt: number;
};

type PendingAutoModeRequest = {
  resolve: (mode: ResolvedOriginMode) => void;
  timer: ReturnType<typeof setTimeout>;
};

class Serializer {
  private chain: Promise<void> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const frameRegistrySerializer = new Serializer();

type FillPortState = {
  port: Browser.runtime.Port;
  tabId: number;
  batchId: string | null;
};

const frameKey = (tabId: number, frameId: number): string =>
  `${tabId}:${frameId}`;

const emptyCounts = (): FillCounts => ({
  filled: 0,
  skipped: 0,
  failed: 0,
  unsupported: 0,
});

export default defineBackground(() => {
  let inflightNonForce: Promise<Profile> | null = null;
  let inflightForce: Promise<Profile> | null = null;
  const pendingFillBatches = new Map<number, PendingFillBatch>();
  const fillPorts = new Set<FillPortState>();
  const portStateByBatchId = new Map<string, FillPortState>();
  const mainWorldInjected = new Set<string>();

  const frameAutoModeCache = new Map<string, FrameAutoModeCacheEntry>();
  const pendingAutoModeRequests = new Map<string, PendingAutoModeRequest>();

  let cachedBroadcastFilter: { patterns: string; regexes: RegExp[] } | null =
    null;

  const safePortPost = (
    port: Browser.runtime.Port,
    msg: FillPortOutgoing,
  ): void => {
    try {
      port.postMessage(msg);
    } catch {}
  };

  const findPortStateForBatch = (batchId: string): FillPortState | null => {
    return portStateByBatchId.get(batchId) ?? null;
  };

  const computeTotalForBatch = (tabId: number): number => {
    const batch = pendingFillBatches.get(tabId);
    if (!batch) return 0;
    let total = 0;
    for (const v of batch.totalByFrame.values()) total += v;
    return total;
  };

  const injectMainWorld = async (
    tabId: number,
    frameId: number,
  ): Promise<void> => {
    const key = frameKey(tabId, frameId);
    if (mainWorldInjected.has(key)) return;
    mainWorldInjected.add(key);
    try {
      await browser.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN",
        files: [MAIN_WORLD_SCRIPT_PATH],
      });
    } catch (e) {
      mainWorldInjected.delete(key);
      console.warn(
        "[TP] main-world injection failed",
        tabId,
        frameId,
        (e as Error).message,
      );
    }
  };

  const registerDynamicScripts = async (pattern: string): Promise<void> => {
    const ids = dynamicScriptIds(pattern);
    let existing: Browser.scripting.RegisteredContentScript[] = [];
    try {
      existing = await browser.scripting.getRegisteredContentScripts({
        ids: [ids.content, ids.main],
      });
    } catch {
      existing = [];
    }
    const existingIds = new Set(existing.map((s) => s.id));
    const toRegister: Browser.scripting.RegisteredContentScript[] = [];
    if (!existingIds.has(ids.content)) {
      toRegister.push({
        id: ids.content,
        matches: [pattern],
        js: [CONTENT_SCRIPT_PATH],
        runAt: "document_idle",
        allFrames: true,
        world: "ISOLATED",
      });
    }
    if (!existingIds.has(ids.main)) {
      toRegister.push({
        id: ids.main,
        matches: [pattern],
        js: [MAIN_WORLD_SCRIPT_PATH],
        runAt: "document_idle",
        allFrames: true,
        world: "MAIN",
      });
    }
    if (toRegister.length === 0) return;
    try {
      await browser.scripting.registerContentScripts(toRegister);
    } catch (e) {
      console.warn(
        "[TP] registerDynamicScripts failed",
        pattern,
        (e as Error).message,
      );
      throw e;
    }
  };

  const unregisterDynamicScripts = async (pattern: string): Promise<void> => {
    const ids = dynamicScriptIds(pattern);
    try {
      await browser.scripting.unregisterContentScripts({
        ids: [ids.content, ids.main],
      });
    } catch (e) {
      console.warn(
        "[TP] unregisterDynamicScripts ignored",
        (e as Error).message,
      );
    }
  };

  const reconcileRegisteredScripts = async (): Promise<void> => {
    const enabled = await getEnabledPatterns();
    const granted = await browser.permissions.getAll();
    const grantedOrigins = new Set(granted.origins ?? []);
    const stillValid = enabled.filter((p) => grantedOrigins.has(p));
    if (stillValid.length !== enabled.length) {
      const current = await getEnabledOrigins();
      const filtered = current.filter((e) => stillValid.includes(e.pattern));
      await setEnabledOrigins(filtered);
    }
    if (stillValid.length === 0) return;

    const allIds = stillValid.flatMap((p) => {
      const ids = dynamicScriptIds(p);
      return [ids.content, ids.main];
    });
    let existing: Browser.scripting.RegisteredContentScript[] = [];
    try {
      existing = await browser.scripting.getRegisteredContentScripts({
        ids: allIds,
      });
    } catch {
      existing = [];
    }
    const existingIds = new Set(existing.map((s) => s.id));
    const toRegister: Browser.scripting.RegisteredContentScript[] = [];
    for (const pattern of stillValid) {
      const ids = dynamicScriptIds(pattern);
      if (!existingIds.has(ids.content)) {
        toRegister.push({
          id: ids.content,
          matches: [pattern],
          js: [CONTENT_SCRIPT_PATH],
          runAt: "document_idle",
          allFrames: true,
          world: "ISOLATED",
        });
      }
      if (!existingIds.has(ids.main)) {
        toRegister.push({
          id: ids.main,
          matches: [pattern],
          js: [MAIN_WORLD_SCRIPT_PATH],
          runAt: "document_idle",
          allFrames: true,
          world: "MAIN",
        });
      }
    }
    if (toRegister.length === 0) return;
    try {
      await browser.scripting.registerContentScripts(toRegister);
    } catch (e) {
      console.warn(
        "[TP] reconcileRegisteredScripts failed",
        (e as Error).message,
      );
    }
  };

  const injectIntoActiveFrames = async (pattern: string): Promise<void> => {
    try {
      let matchingTabs: Browser.tabs.Tab[] = [];
      try {
        matchingTabs = await browser.tabs.query({ url: pattern });
      } catch {
        matchingTabs = await browser.tabs.query({});
      }
      for (const tab of matchingTabs) {
        if (typeof tab.id !== "number") continue;
        let frames: Browser.webNavigation.GetAllFrameResultDetails[] = [];
        try {
          const result = await browser.webNavigation.getAllFrames({
            tabId: tab.id,
          });
          frames = result ?? [];
        } catch {
          continue;
        }
        for (const frame of frames) {
          const url = frame.url ?? "";
          if (!urlMatchesPatternOrigin(url, pattern)) continue;
          try {
            await browser.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [frame.frameId] },
              files: [CONTENT_SCRIPT_PATH],
              world: "ISOLATED",
            });
            await browser.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [frame.frameId] },
              files: [MAIN_WORLD_SCRIPT_PATH],
              world: "MAIN",
            });
          } catch {}
        }
      }
    } catch (e) {
      console.warn("[TP] injectIntoActiveFrames failed", (e as Error).message);
    }
  };

  const buildTabOriginInfo = async (
    tabId: number,
  ): Promise<TabOriginInfo | null> => {
    let frames: Browser.webNavigation.GetAllFrameResultDetails[] = [];
    try {
      const result = await browser.webNavigation.getAllFrames({ tabId });
      frames = result ?? [];
    } catch {
      return null;
    }
    if (frames.length === 0) return null;
    const top = frames.find((f) => f.frameId === 0);
    if (!top || !top.url) return null;
    const topPattern = normalizeOriginPattern(top.url);
    if (!topPattern) return null;
    const topOrigin = originFromPattern(topPattern) ?? "";

    const enabledList = await getEnabledOrigins();
    const enabledMap = new Map(enabledList.map((e) => [e.pattern, e.mode]));
    const granted = await browser.permissions.getAll();
    const grantedSet = new Set(granted.origins ?? []);

    const iframeMap = new Map<string, { pattern: string; origin: string }>();
    for (const frame of frames) {
      if (frame.frameId === 0) continue;
      if (!frame.url) continue;
      if (!/^https?:/i.test(frame.url)) continue;
      const pattern = normalizeOriginPattern(frame.url);
      if (!pattern) continue;
      if (pattern === topPattern) continue;
      if (iframeMap.has(pattern)) continue;
      const origin = originFromPattern(pattern) ?? "";
      iframeMap.set(pattern, { pattern, origin });
    }

    const iframeOrigins = Array.from(iframeMap.values()).map((f) => ({
      origin: f.origin,
      pattern: f.pattern,
      enabled: enabledMap.has(f.pattern),
      permitted: grantedSet.has(f.pattern),
      mode: enabledMap.get(f.pattern) ?? null,
    }));

    return {
      topOrigin,
      topPattern,
      topEnabled: enabledMap.has(topPattern),
      topPermitted: grantedSet.has(topPattern),
      topMode: enabledMap.get(topPattern) ?? null,
      iframeOrigins,
    };
  };

  const broadcastModeToOrigin = (pattern: string, mode: OriginMode): void => {
    void (async () => {
      let matchingTabs: Browser.tabs.Tab[] = [];
      try {
        matchingTabs = await browser.tabs.query({ url: pattern });
      } catch {
        matchingTabs = await browser.tabs.query({});
      }
      for (const tab of matchingTabs) {
        if (typeof tab.id !== "number") continue;
        const url = tab.url ?? "";
        if (!urlMatchesPatternOrigin(url, pattern)) continue;

        if (mode === "auto") {
          let frames: Browser.webNavigation.GetAllFrameResultDetails[] = [];
          try {
            const result = await browser.webNavigation.getAllFrames({
              tabId: tab.id,
            });
            frames = result ?? [];
          } catch {
            frames = [];
          }
          for (const frame of frames) {
            const frameUrl = frame.url ?? "";
            if (!urlMatchesPatternOrigin(frameUrl, pattern)) continue;
            frameAutoModeCache.delete(frameKey(tab.id, frame.frameId));
            browser.tabs
              .sendMessage(
                tab.id,
                { kind: "mode.resolveAuto" },
                {
                  frameId: frame.frameId,
                },
              )
              .catch(() => {});
          }
          continue;
        }

        const resolved: ResolvedOriginMode =
          mode === "application" ? "application" : "notesOnly";
        browser.tabs
          .sendMessage(tab.id, { kind: "mode.changed", mode: resolved })
          .catch(() => {});
      }
    })().catch(() => {});
  };

  const grantAndEnableOrigin = async (
    pattern: string,
    mode: OriginMode,
  ): Promise<{ ok: boolean; error?: string }> => {
    let hasPermission = false;
    try {
      hasPermission = await browser.permissions.contains({
        origins: [pattern],
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    if (!hasPermission) {
      return { ok: false, error: "Permission not granted" };
    }
    await addEnabledOrigin(pattern, mode);
    cachedBroadcastFilter = null;
    try {
      await registerDynamicScripts(pattern);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    void injectIntoActiveFrames(pattern);
    broadcastModeToOrigin(pattern, mode);
    return { ok: true };
  };

  const revokeAndDisableOrigin = async (
    pattern: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    await removeEnabledOrigin(pattern);
    cachedBroadcastFilter = null;
    await unregisterDynamicScripts(pattern);
    try {
      await browser.permissions.remove({ origins: [pattern] });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: true };
  };

  const setOriginModeAndBroadcast = async (
    pattern: string,
    mode: OriginMode,
  ): Promise<{ ok: boolean; error?: string }> => {
    const updated = await updateEnabledOriginMode(pattern, mode);
    if (!updated) return { ok: false, error: "Origin not enabled" };
    broadcastModeToOrigin(pattern, mode);
    return { ok: true };
  };

  const listEnabledOriginEntries = async (): Promise<EnabledOriginEntry[]> => {
    const entries = await getEnabledOrigins();
    return entries
      .map((entry) => ({
        origin: originFromPattern(entry.pattern) ?? "",
        pattern: entry.pattern,
        mode: entry.mode,
      }))
      .filter((e) => e.origin.length > 0);
  };

  const getAuthStatus = async (): Promise<AuthStatus> => {
    const tokens = await getTokens();
    if (!tokens?.accessToken)
      return { authenticated: false, reason: "no-token" };

    if (isExpired(tokens.accessToken)) {
      const outcome = await refreshAccessToken();
      if (outcome.kind === "network") {
        return { authenticated: false, reason: "network-error" };
      }
      if (outcome.kind === "rejected") {
        return { authenticated: false, reason: "refresh-failed" };
      }
    }

    const fresh = await getTokens();
    const email = fresh?.accessToken ? extractEmail(fresh.accessToken) : null;
    return { authenticated: true, email, method: fresh?.method ?? null };
  };

  const getCachedProfile = async (): Promise<{
    data: Profile;
    fetchedAt: number;
  } | null> => {
    const res = await browser.storage.session.get(PROFILE_CACHE_KEY);
    return (
      (res[PROFILE_CACHE_KEY] as { data: Profile; fetchedAt: number }) ?? null
    );
  };

  const setCachedProfile = async (data: Profile): Promise<void> => {
    await browser.storage.session.set({
      [PROFILE_CACHE_KEY]: { data, fetchedAt: Date.now() },
    });
  };

  const clearCachedProfile = async (): Promise<void> => {
    await browser.storage.session.remove(PROFILE_CACHE_KEY);
  };

  const patchCachedProfile = async (
    patcher: (p: Profile) => Profile,
  ): Promise<void> => {
    const cached = await getCachedProfile();
    if (!cached) return;
    const updated = patcher(cached.data);
    await browser.storage.session.set({
      [PROFILE_CACHE_KEY]: { data: updated, fetchedAt: cached.fetchedAt },
    });
  };

  const ensureAuthenticated = async (): Promise<boolean> => {
    const status = await getAuthStatus();
    if (!status.authenticated) {
      if (status.reason !== "network-error") {
        await clearCachedProfile();
      }
      return false;
    }
    return true;
  };

  const getProfile = async (force = false): Promise<Profile> => {
    if (!force) {
      const cached = await getCachedProfile();
      if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
        return cached.data;
      }
      if (inflightNonForce) return inflightNonForce;
      inflightNonForce = (async () => {
        try {
          const profile = await fetchMyProfile();
          await setCachedProfile(profile);
          return profile;
        } finally {
          inflightNonForce = null;
        }
      })();
      return inflightNonForce;
    }

    if (inflightForce) return inflightForce;
    inflightForce = (async () => {
      try {
        const profile = await fetchMyProfile();
        await setCachedProfile(profile);
        return profile;
      } finally {
        inflightForce = null;
      }
    })();
    return inflightForce;
  };

  const getFrameRegistry = async (): Promise<FrameRegistry> => {
    const res = await browser.storage.session.get(FRAME_REGISTRY_KEY);
    return (res[FRAME_REGISTRY_KEY] as FrameRegistry) ?? {};
  };

  const addFrameToRegistry = (
    tabId: number,
    frameId: number,
    ats: AtsName,
  ): Promise<void> => {
    return frameRegistrySerializer.run(async () => {
      const reg = await getFrameRegistry();
      const frames = reg[tabId] ?? [];
      const existing = frames.find((f) => f.frameId === frameId);
      if (existing) {
        existing.ats = ats;
      } else {
        frames.push({ frameId, ats });
      }
      reg[tabId] = frames;
      await browser.storage.session.set({ [FRAME_REGISTRY_KEY]: reg });
    });
  };

  const removeFrameFromRegistry = (
    tabId: number,
    frameId: number,
  ): Promise<void> => {
    return frameRegistrySerializer.run(async () => {
      const reg = await getFrameRegistry();
      const frames = reg[tabId];
      if (!frames) return;
      const next = frames.filter((f) => f.frameId !== frameId);
      if (next.length === frames.length) return;
      if (next.length === 0) {
        delete reg[tabId];
      } else {
        reg[tabId] = next;
      }
      await browser.storage.session.set({ [FRAME_REGISTRY_KEY]: reg });
    });
  };

  const removeTabFromRegistry = (tabId: number): Promise<void> => {
    return frameRegistrySerializer.run(async () => {
      const reg = await getFrameRegistry();
      if (tabId in reg) {
        delete reg[tabId];
        await browser.storage.session.set({ [FRAME_REGISTRY_KEY]: reg });
      }
    });
  };

  const purgeInjectionMarkersForTab = (tabId: number): void => {
    const prefix = `${tabId}:`;
    for (const key of Array.from(mainWorldInjected)) {
      if (key.startsWith(prefix)) {
        mainWorldInjected.delete(key);
      }
    }
  };

  const purgeInjectionMarkerForFrame = (
    tabId: number,
    frameId: number,
  ): void => {
    mainWorldInjected.delete(frameKey(tabId, frameId));
  };

  const purgeFrameAutoModeForTab = (tabId: number): void => {
    const prefix = `${tabId}:`;
    for (const key of Array.from(frameAutoModeCache.keys())) {
      if (key.startsWith(prefix)) frameAutoModeCache.delete(key);
    }
    for (const key of Array.from(pendingAutoModeRequests.keys())) {
      if (key.startsWith(prefix)) {
        const req = pendingAutoModeRequests.get(key);
        if (req) {
          clearTimeout(req.timer);
          req.resolve("notesOnly");
        }
        pendingAutoModeRequests.delete(key);
      }
    }
  };

  const purgeFrameAutoModeForFrame = (tabId: number, frameId: number): void => {
    const key = frameKey(tabId, frameId);
    frameAutoModeCache.delete(key);
    const req = pendingAutoModeRequests.get(key);
    if (req) {
      clearTimeout(req.timer);
      req.resolve("notesOnly");
      pendingAutoModeRequests.delete(key);
    }
  };

  const requestFrameAutoMode = async (
    tabId: number,
    frameId: number,
  ): Promise<ResolvedOriginMode> => {
    const key = frameKey(tabId, frameId);
    const existing = pendingAutoModeRequests.get(key);
    if (existing) {
      return new Promise((resolve) => {
        const previousResolve = existing.resolve;
        existing.resolve = (mode) => {
          previousResolve(mode);
          resolve(mode);
        };
      });
    }

    return new Promise<ResolvedOriginMode>((resolve) => {
      const timer = setTimeout(() => {
        pendingAutoModeRequests.delete(key);
        resolve("notesOnly");
      }, FRAME_AUTO_MODE_REQUEST_TIMEOUT_MS);

      pendingAutoModeRequests.set(key, { resolve, timer });

      browser.tabs
        .sendMessage(tabId, { kind: "mode.resolveAuto" }, { frameId })
        .catch(() => {
          const pending = pendingAutoModeRequests.get(key);
          if (pending) {
            clearTimeout(pending.timer);
            pendingAutoModeRequests.delete(key);
            resolve("notesOnly");
          }
        });
    });
  };

  const resolveModeForFrame = async (
    tabId: number | undefined,
    frameId: number | undefined,
    senderUrl: string | undefined,
  ): Promise<ResolvedOriginMode> => {
    if (!senderUrl) return "notesOnly";
    const pattern = normalizeOriginPattern(senderUrl);
    if (!pattern) return "notesOnly";
    const stored = await getOriginMode(pattern);
    if (stored === "application") return "application";
    if (stored === "notesOnly") return "notesOnly";

    let detectedAts: AtsName = "generic";
    try {
      detectedAts = detectAtsHost(new URL(senderUrl).hostname);
    } catch {}

    if (stored === "auto") {
      if (detectedAts !== "generic") return "application";
      if (typeof tabId !== "number" || typeof frameId !== "number") {
        return "notesOnly";
      }
      const key = frameKey(tabId, frameId);
      const cached = frameAutoModeCache.get(key);
      if (cached && Date.now() - cached.resolvedAt < FRAME_AUTO_MODE_TTL_MS) {
        return cached.mode;
      }
      return requestFrameAutoMode(tabId, frameId);
    }

    if (detectedAts !== "generic") return "application";
    return "notesOnly";
  };

  const toSummary = (p: Profile): ProfileSummary => {
    const { profileScore, scoreItems } = calculateProfileScore(p);
    return {
      profileName: p.profileName,
      email: p.user?.email ?? null,
      jobTitle: p.jobTitle,
      profileScore,
      scoreItems,
    };
  };

  const buildBroadcastTabFilter = async (): Promise<
    (url: string) => boolean
  > => {
    const enabled = await getEnabledPatterns();
    const all = [...STATIC_HOST_PATTERNS, ...enabled];
    const key = all.join("|");
    if (!cachedBroadcastFilter || cachedBroadcastFilter.patterns !== key) {
      const regexes = all
        .map((p) => patternToRegex(p))
        .filter((r): r is RegExp => r !== null);
      cachedBroadcastFilter = { patterns: key, regexes };
    }
    return (url: string) =>
      cachedBroadcastFilter!.regexes.some((r) => r.test(url));
  };

  const broadcastAuthChanged = (): void => {
    browser.runtime.sendMessage({ kind: "auth.changed" }).catch(() => {});
    (async () => {
      const matchesPattern = await buildBroadcastTabFilter();
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        const url = tab.url ?? "";
        if (!url || !matchesPattern(url)) continue;
        browser.tabs
          .sendMessage(tab.id, { kind: "auth.changed" })
          .catch(() => {});
      }
    })().catch(() => {});
  };

  const openConnectPageFromTab = async (
    originatingTabId: number | undefined,
    originatingWindowId: number | undefined,
  ): Promise<void> => {
    const url = buildConnectUrl();
    const created = await browser.tabs.create({ url, active: true });
    if (
      typeof originatingTabId === "number" &&
      typeof created.id === "number"
    ) {
      const attempt: ConnectAttempt = {
        connectTabId: created.id,
        openedAt: Date.now(),
        originatingTabId,
        originatingWindowId:
          typeof originatingWindowId === "number"
            ? originatingWindowId
            : created.windowId ?? -1,
      };
      await setConnectAttempt(attempt);
    }
  };

  const finalizeConnectAttempt = async (
    senderTabId: number | undefined,
  ): Promise<void> => {
    const attempt = await getConnectAttempt();
    if (!attempt) return;
    await clearConnectAttempt();

    const matchesSender =
      typeof senderTabId === "number" && senderTabId === attempt.connectTabId;

    const targetTabId = matchesSender ? attempt.connectTabId : null;
    if (typeof targetTabId === "number") {
      browser.tabs.remove(targetTabId).catch(() => {});
    }
    browser.tabs
      .update(attempt.originatingTabId, { active: true })
      .catch(() => {});
    if (attempt.originatingWindowId >= 0) {
      browser.windows
        .update(attempt.originatingWindowId, { focused: true })
        .catch(() => {});
    }
  };

  const computeFramesUnresponsive = (batch: PendingFillBatch): number => {
    const unreported = batch.expectedFrames - batch.framesReported.size;
    return Math.max(0, unreported);
  };

  const finalizeBatch = (batch: PendingFillBatch): void => {
    if (batch.finalized) return;
    batch.finalized = true;
    pendingFillBatches.delete(batch.tabId);
    portStateByBatchId.delete(batch.batchId);
    if (batch.globalTimer !== null) {
      clearTimeout(batch.globalTimer);
      batch.globalTimer = null;
    }
    for (const fp of batch.framePending.values()) {
      clearTimeout(fp.timer);
    }
    batch.framePending.clear();
    let total = 0;
    for (const v of batch.totalByFrame.values()) total += v;
    const done =
      batch.counts.filled +
      batch.counts.skipped +
      batch.counts.failed +
      batch.counts.unsupported;
    if (done < total) {
      batch.counts.failed += total - done;
    }
    batch.resolve({
      counts: batch.counts,
      framesTimedOut: batch.framesTimedOut,
      framesUnresponsive: computeFramesUnresponsive(batch),
      total,
      passes: batch.maxPasses,
      error: batch.batchError,
    });
  };

  const finalizeBatchForTab = (
    tabId: number,
    errorKind: FillBatchErrorKind,
    message: string,
  ): void => {
    const batch = pendingFillBatches.get(tabId);
    if (!batch) return;
    batch.framesTimedOut += batch.framePending.size;
    batch.batchError = { kind: errorKind, message };
    const portState = findPortStateForBatch(batch.batchId);
    finalizeBatch(batch);
    if (portState) {
      safePortPost(portState.port, {
        kind: "fill.error",
        error: { kind: errorKind, message },
      });
    }
  };

  const recordFrameFillResult = (
    tabId: number,
    frameId: number | undefined,
    batchId: string,
  ): void => {
    const batch = pendingFillBatches.get(tabId);
    if (!batch) return;
    if (batch.batchId !== batchId) {
      console.warn(
        "[TP] dropping fill result from stale batch",
        batchId,
        "current",
        batch.batchId,
      );
      return;
    }
    if (typeof frameId === "number" && !batch.framePending.has(frameId)) {
      return;
    }
    batch.receivedFrames++;
    if (typeof frameId === "number") {
      batch.framesReported.add(frameId);
      const fp = batch.framePending.get(frameId);
      if (fp) {
        clearTimeout(fp.timer);
        batch.framePending.delete(frameId);
      }
    }
    if (batch.receivedFrames >= batch.expectedFrames) {
      finalizeBatch(batch);
    }
  };

  const recordFrameDeliveryFailure = (
    tabId: number,
    frameId: number,
    batchId: string,
  ): void => {
    const batch = pendingFillBatches.get(tabId);
    if (!batch) return;
    if (batch.batchId !== batchId) return;
    if (!batch.framePending.has(frameId)) return;
    const fp = batch.framePending.get(frameId);
    if (fp) {
      clearTimeout(fp.timer);
      batch.framePending.delete(frameId);
    }
    batch.framesFailedDelivery++;
    batch.receivedFrames++;

    if (batch.receivedFrames >= batch.expectedFrames) {
      finalizeBatch(batch);
    }
  };

  const recordFrameTimeout = (
    tabId: number,
    batchId: string,
    frameId: number,
  ): void => {
    const batch = pendingFillBatches.get(tabId);
    if (!batch) return;
    if (batch.batchId !== batchId) return;
    const fp = batch.framePending.get(frameId);
    if (!fp) return;
    batch.framePending.delete(frameId);
    batch.framesTimedOut++;
    batch.receivedFrames++;
    if (batch.receivedFrames >= batch.expectedFrames) {
      finalizeBatch(batch);
    }
  };

  const startFillBatch = (
    tabId: number,
    frameIds: number[],
  ): { batchId: string; result: Promise<FillBatchResult> } | null => {
    if (pendingFillBatches.has(tabId)) {
      return null;
    }
    const batchId = crypto.randomUUID();
    const result = new Promise<FillBatchResult>((resolve) => {
      const batch: PendingFillBatch = {
        batchId,
        tabId,
        expectedFrames: frameIds.length,
        receivedFrames: 0,
        framesTimedOut: 0,
        framesFailedDelivery: 0,
        framePending: new Map(),
        framesReported: new Set(),
        counts: emptyCounts(),
        resolve,
        globalTimer: null,
        finalized: false,
        totalByFrame: new Map(),
        maxPasses: 0,
      };
      batch.globalTimer = setTimeout(() => {
        batch.framesTimedOut += batch.framePending.size;
        if (!batch.batchError) {
          batch.batchError = {
            kind: "aborted",
            message: "Fill timed out",
          };
        }
        finalizeBatch(batch);
      }, FILL_GLOBAL_TIMEOUT_MS);
      for (const frameId of frameIds) {
        const timer = setTimeout(() => {
          recordFrameTimeout(tabId, batchId, frameId);
        }, FILL_PER_FRAME_TIMEOUT_MS);
        batch.framePending.set(frameId, { frameId, timer });
      }
      pendingFillBatches.set(tabId, batch);
    });
    return { batchId, result };
  };

  const readFramesForTab = (tabId: number): Promise<number[]> => {
    return frameRegistrySerializer.run(async () => {
      const reg = await getFrameRegistry();
      return (reg[tabId] ?? []).map((f) => f.frameId);
    });
  };

  const readAtsForTab = (tabId: number): Promise<AtsName | null> => {
    return frameRegistrySerializer.run(async () => {
      const reg = await getFrameRegistry();
      const frames = reg[tabId] ?? [];
      if (frames.length === 0) return null;
      const nonGeneric = frames.find((f) => f.ats !== "generic");
      if (nonGeneric) return nonGeneric.ats;
      return frames[0].ats;
    });
  };

  const startFillForPort = async (state: FillPortState): Promise<void> => {
    if (!(await ensureAuthenticated())) {
      safePortPost(state.port, {
        kind: "fill.error",
        error: { kind: "not-authenticated", message: "Not authenticated" },
      });
      return;
    }
    if (pendingFillBatches.has(state.tabId)) {
      safePortPost(state.port, {
        kind: "fill.error",
        error: {
          kind: "busy",
          message: "A fill is already in progress for this tab",
        },
      });
      return;
    }
    const frames = await readFramesForTab(state.tabId);
    if (frames.length === 0) {
      safePortPost(state.port, {
        kind: "fill.error",
        error: {
          kind: "no-frames",
          message: "No content frames are ready on this page",
        },
      });
      return;
    }
    const started = startFillBatch(state.tabId, frames);
    if (!started) {
      safePortPost(state.port, {
        kind: "fill.error",
        error: {
          kind: "busy",
          message: "A fill is already in progress for this tab",
        },
      });
      return;
    }
    state.batchId = started.batchId;
    portStateByBatchId.set(started.batchId, state);

    for (const frameId of frames) {
      browser.tabs
        .sendMessage(
          state.tabId,
          { kind: "tab.fillAll", batchId: started.batchId },
          { frameId },
        )
        .catch(() => {
          recordFrameDeliveryFailure(state.tabId, frameId, started.batchId);
        });
    }

    const aggregate = await started.result;
    safePortPost(state.port, { kind: "fill.done", result: aggregate });
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "fill-progress") return;
    const state: FillPortState = {
      port,
      tabId: -1,
      batchId: null,
    };
    fillPorts.add(state);
    port.onMessage.addListener((msg: FillPortIncoming) => {
      if (msg.kind === "fill.start") {
        state.tabId = msg.tabId;
        void startFillForPort(state);
      }
    });
    port.onDisconnect.addListener(() => {
      fillPorts.delete(state);
      if (state.batchId !== null) {
        portStateByBatchId.delete(state.batchId);
      }
      if (state.batchId !== null && state.tabId >= 0) {
        const batch = pendingFillBatches.get(state.tabId);
        if (batch && batch.batchId === state.batchId && !batch.finalized) {
          finalizeBatchForTab(state.tabId, "aborted", "port disconnected");
        }
      }
    });
  });

  const handleExternalAuth = async (
    message: ExternalToBackground,
    senderTabId: number | undefined,
  ): Promise<BackgroundResponse> => {
    if (message.kind === "auth.ping") {
      return { ok: true, data: { installed: true } };
    }
    if (message.kind === "auth.handoff") {
      if (
        typeof message.token !== "string" ||
        typeof message.refreshToken !== "string" ||
        message.token.length === 0 ||
        message.refreshToken.length === 0
      ) {
        return { ok: false, error: "Invalid token payload" };
      }
      if (isExpired(message.token)) {
        return { ok: false, error: "Token already expired" };
      }
      await setTokens({
        accessToken: message.token,
        refreshToken: message.refreshToken,
        method: message.method ?? null,
      });
      await clearCachedProfile();
      broadcastAuthChanged();
      void finalizeConnectAttempt(senderTabId);
      return { ok: true };
    }
    return { ok: false, error: "Unknown external message kind" };
  };

  browser.runtime.onMessageExternal.addListener(
    (message: unknown, sender, sendResponse) => {
      (async () => {
        try {
          if (!message || typeof message !== "object" || !("kind" in message)) {
            sendResponse({ ok: false, error: "Invalid message" });
            return;
          }
          const result = await handleExternalAuth(
            message as ExternalToBackground,
            sender.tab?.id,
          );
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: (e as Error).message });
        }
      })();
      return true;
    },
  );

  const notifyFrameOfResolvedMode = (
    tabId: number,
    frameId: number,
    mode: ResolvedOriginMode,
  ): void => {
    browser.tabs
      .sendMessage(tabId, { kind: "mode.changed", mode }, { frameId })
      .catch(() => {});
  };

  const handleMessage = async (
    message: ContentToBackground | PopupToBackground,
    sender: Browser.runtime.MessageSender,
  ): Promise<BackgroundResponse> => {
    switch (message.kind) {
      case "auth.logout": {
        await clearTokens();
        await clearCachedProfile();
        broadcastAuthChanged();
        return { ok: true };
      }
      case "auth.cancelConnect": {
        await clearConnectAttempt();
        return { ok: true };
      }
      case "auth.status": {
        return { ok: true, data: await getAuthStatus() };
      }
      case "auth.openConnectPage": {
        try {
          await openConnectPageFromTab(sender.tab?.id, sender.tab?.windowId);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      case "auth.openDashboard": {
        try {
          await browser.tabs.create({
            url: WEB_APP_DASHBOARD_URL,
            active: true,
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      case "profile.summary": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        try {
          const profile = await getProfile(false);
          return { ok: true, data: toSummary(profile) };
        } catch (e) {
          if (e instanceof NetworkError) {
            return { ok: false, error: "network-error" };
          }
          if (e instanceof AuthError) {
            return { ok: false, error: "Not authenticated" };
          }
          return { ok: false, error: (e as Error).message };
        }
      }
      case "profile.refresh": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        try {
          const profile = await getProfile(true);
          return { ok: true, data: toSummary(profile) };
        } catch (e) {
          if (e instanceof NetworkError) {
            return { ok: false, error: "network-error" };
          }
          if (e instanceof AuthError) {
            return { ok: false, error: "Not authenticated" };
          }
          return { ok: false, error: (e as Error).message };
        }
      }
      case "profile.get": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        try {
          const profile = await getProfile(false);
          return { ok: true, data: profile };
        } catch (e) {
          if (e instanceof NetworkError) {
            return { ok: false, error: "network-error" };
          }
          if (e instanceof AuthError) {
            return { ok: false, error: "Not authenticated" };
          }
          return { ok: false, error: (e as Error).message };
        }
      }
      case "note.create": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        const content = (message.content ?? "").trim();
        if (!content) return { ok: false, error: "Content is required" };
        if (content.length > 4000) {
          return { ok: false, error: "Content exceeds 4000 characters" };
        }
        try {
          const note = await apiFetch<ProfileNote>("/api/v1/talentnote", {
            method: "POST",
            body: JSON.stringify({ data: { content } }),
          });
          if (note) {
            await patchCachedProfile((p) => ({
              ...p,
              talentNotes: [note, ...(p.talentNotes ?? [])],
            }));
          }
          return { ok: true, data: note };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      case "note.touch": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        try {
          const nowIso = new Date().toISOString();
          await apiFetch("/api/v1/talentnote", {
            method: "PUT",
            body: JSON.stringify({
              where: { id: message.noteId },
              data: { lastUsedAt: nowIso },
            }),
          });
          await patchCachedProfile((p) => ({
            ...p,
            talentNotes: (p.talentNotes ?? []).map((n) =>
              n.id === message.noteId ? { ...n, lastUsedAt: nowIso } : n,
            ),
          }));
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      case "note.update": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        const content = (message.content ?? "").trim();
        if (!content) return { ok: false, error: "Content is required" };
        if (content.length > 4000) {
          return { ok: false, error: "Content exceeds 4000 characters" };
        }
        if (!message.noteId) return { ok: false, error: "Missing note id" };
        try {
          const note = await apiFetch<ProfileNote>("/api/v1/talentnote", {
            method: "PUT",
            body: JSON.stringify({
              where: { id: message.noteId },
              data: { content },
            }),
          });
          if (note) {
            await patchCachedProfile((p) => ({
              ...p,
              talentNotes: (p.talentNotes ?? []).map((n) =>
                n.id === message.noteId ? note : n,
              ),
            }));
          }
          return { ok: true, data: note };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      case "note.delete": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        if (!message.noteId) return { ok: false, error: "Missing note id" };
        try {
          await apiFetch("/api/v1/talentnote", {
            method: "DELETE",
            body: JSON.stringify({
              where: { id: message.noteId },
            }),
          });
          await patchCachedProfile((p) => ({
            ...p,
            talentNotes: (p.talentNotes ?? []).filter(
              (n) => n.id !== message.noteId,
            ),
          }));
          return { ok: true, data: { id: message.noteId } };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      case "mode.get": {
        const url = sender.url ?? sender.tab?.url;
        const tabId = sender.tab?.id;
        const frameId = sender.frameId;
        const mode = await resolveModeForFrame(tabId, frameId, url);
        return { ok: true, data: mode };
      }
      case "mode.frameResolved": {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId;
        if (typeof tabId === "number" && typeof frameId === "number") {
          const key = frameKey(tabId, frameId);
          frameAutoModeCache.set(key, {
            mode: message.mode,
            resolvedAt: Date.now(),
          });
          const pending = pendingAutoModeRequests.get(key);
          if (pending) {
            clearTimeout(pending.timer);
            pendingAutoModeRequests.delete(key);
            pending.resolve(message.mode);
          }
          notifyFrameOfResolvedMode(tabId, frameId, message.mode);
        }
        return { ok: true };
      }
      case "resolve": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        try {
          const profile = await getProfile(false);
          const result = resolveField(
            message.fieldName,
            message.fieldType,
            message.section,
            profile,
          );
          return { ok: true, data: result };
        } catch (e) {
          if (e instanceof NetworkError) {
            return { ok: false, error: "network-error" };
          }
          if (e instanceof AuthError) {
            return { ok: false, error: "Not authenticated" };
          }
          return { ok: false, error: (e as Error).message };
        }
      }
      case "resolveMany": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        try {
          const profile = await getProfile(false);
          const out = message.fields.map((f) => ({
            requestId: f.requestId,
            value: resolveField(f.fieldName, f.fieldType, f.section, profile),
          }));
          return { ok: true, data: out };
        } catch (e) {
          if (e instanceof NetworkError) {
            return { ok: false, error: "network-error" };
          }
          if (e instanceof AuthError) {
            return { ok: false, error: "Not authenticated" };
          }
          return { ok: false, error: (e as Error).message };
        }
      }
      case "frame.register": {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId;
        if (typeof tabId === "number" && typeof frameId === "number") {
          await addFrameToRegistry(tabId, frameId, message.ats);
          void injectMainWorld(tabId, frameId);
        }
        return { ok: true };
      }
      case "frame.fillStarted": {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? -1;
        if (typeof tabId === "number") {
          const batch = pendingFillBatches.get(tabId);
          if (batch && batch.batchId === message.batchId) {
            batch.totalByFrame.set(frameId, message.total);
            const portState = findPortStateForBatch(message.batchId);
            if (portState) {
              safePortPost(portState.port, {
                kind: "fill.frame.started",
                total: computeTotalForBatch(tabId),
                pass: message.pass,
              });
            }
          }
        }
        return { ok: true };
      }
      case "frame.fillProgress": {
        const tabId = sender.tab?.id;
        if (typeof tabId === "number") {
          const batch = pendingFillBatches.get(tabId);
          if (batch && batch.batchId === message.batchId) {
            batch.counts.filled += message.delta.filled;
            batch.counts.skipped += message.delta.skipped;
            batch.counts.failed += message.delta.failed;
            batch.counts.unsupported += message.delta.unsupported;
            const portState = findPortStateForBatch(message.batchId);
            if (portState) {
              safePortPost(portState.port, {
                kind: "fill.progress",
                counts: { ...batch.counts },
                total: computeTotalForBatch(tabId),
                pass: message.pass,
              });
            }
          }
        }
        return { ok: true };
      }
      case "frame.fillTotalIncreased": {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? -1;
        if (typeof tabId === "number") {
          const batch = pendingFillBatches.get(tabId);
          if (batch && batch.batchId === message.batchId) {
            const prev = batch.totalByFrame.get(frameId) ?? 0;
            batch.totalByFrame.set(frameId, prev + message.addedTotal);
            const portState = findPortStateForBatch(message.batchId);
            if (portState) {
              safePortPost(portState.port, {
                kind: "fill.progress",
                counts: { ...batch.counts },
                total: computeTotalForBatch(tabId),
                pass: message.pass,
              });
            }
          }
        }
        return { ok: true };
      }
      case "frame.fillResult": {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId;
        if (typeof tabId === "number") {
          const batch = pendingFillBatches.get(tabId);
          if (batch && batch.batchId === message.batchId) {
            batch.maxPasses = Math.max(batch.maxPasses, message.passes);
          }
          recordFrameFillResult(tabId, frameId, message.batchId);
        }
        return { ok: true };
      }
      case "tab.detectAts": {
        const ats = await readAtsForTab(message.tabId);
        return { ok: true, data: ats };
      }
      case "tab.listOrigins": {
        const info = await buildTabOriginInfo(message.tabId);
        return { ok: true, data: info };
      }
      case "origin.enable": {
        const result = await grantAndEnableOrigin(
          message.pattern,
          message.mode,
        );
        if (result.ok) return { ok: true };
        return { ok: false, error: result.error ?? "Failed" };
      }
      case "origin.disable": {
        const result = await revokeAndDisableOrigin(message.pattern);
        if (result.ok) return { ok: true };
        return { ok: false, error: result.error ?? "Failed" };
      }
      case "origin.setMode": {
        const result = await setOriginModeAndBroadcast(
          message.pattern,
          message.mode,
        );
        if (result.ok) return { ok: true };
        return { ok: false, error: result.error ?? "Failed" };
      }
      case "origin.list": {
        return { ok: true, data: await listEnabledOriginEntries() };
      }
      case "auth.changed": {
        broadcastAuthChanged();
        return { ok: true };
      }
      case "learnedAnswers.resolve": {
        if (!(await ensureAuthenticated())) {
          return {
            ok: true,
            data: message.fields.map((f) => ({
              requestId: f.requestId,
              value: { kind: "unsupported" as const },
              matchedAnswerId: null,
            })),
          };
        }
        try {
          const profile = await getProfile(false);
          const { resolveLearnedAnswersBatch } = await import(
            "~/resolver/learnedAnswers"
          );
          const results = resolveLearnedAnswersBatch(message.fields, profile);
          return { ok: true, data: results };
        } catch {
          return {
            ok: true,
            data: message.fields.map((f) => ({
              requestId: f.requestId,
              value: { kind: "unsupported" as const },
              matchedAnswerId: null,
            })),
          };
        }
      }
      case "learnedAnswers.delete": {
        if (!(await ensureAuthenticated())) {
          return { ok: false, error: "Not authenticated" };
        }
        try {
          const { deleteTalentAnswer } = await import("~/api/talentAnswer");
          await deleteTalentAnswer(message.answerId);
          await patchCachedProfile((p) => ({
            ...p,
            talentAnswers: (p.talentAnswers ?? []).filter(
              (a) => a.id !== message.answerId,
            ),
          }));
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }
      default:
        return { ok: false, error: "Unknown message kind" };
    }
  };

  browser.runtime.onMessage.addListener(
    (
      message: ContentToBackground | PopupToBackground,
      sender,
      sendResponse,
    ) => {
      (async () => {
        try {
          const result = await handleMessage(message, sender);
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: (e as Error).message });
        }
      })();
      return true;
    },
  );

  browser.tabs.onRemoved.addListener(async (tabId) => {
    void removeTabFromRegistry(tabId);
    purgeInjectionMarkersForTab(tabId);
    purgeFrameAutoModeForTab(tabId);
    if (pendingFillBatches.has(tabId)) {
      finalizeBatchForTab(tabId, "aborted", "tab closed");
    }
    const attempt = await getConnectAttempt();
    if (attempt?.connectTabId === tabId) {
      await clearConnectAttempt();
    }
  });

  const handleFrameDisposal = (tabId: number, frameId: number): void => {
    if (frameId === 0) {
      void removeTabFromRegistry(tabId);
      purgeInjectionMarkersForTab(tabId);
      purgeFrameAutoModeForTab(tabId);
      if (pendingFillBatches.has(tabId)) {
        finalizeBatchForTab(tabId, "aborted", "navigation");
      }
    } else {
      void removeFrameFromRegistry(tabId, frameId);
      purgeInjectionMarkerForFrame(tabId, frameId);
      purgeFrameAutoModeForFrame(tabId, frameId);
    }
  };

  if (browser.webNavigation?.onCommitted) {
    browser.webNavigation.onCommitted.addListener((details) => {
      handleFrameDisposal(details.tabId, details.frameId);
    });
  } else {
    console.warn(
      "[TP] webNavigation API not available; frame registry will not auto-clear on navigation",
    );
  }

  if (browser.webNavigation?.onHistoryStateUpdated) {
    browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
      handleFrameDisposal(details.tabId, details.frameId);
    });
  }

  if (browser.permissions?.onRemoved) {
    browser.permissions.onRemoved.addListener(async (perm) => {
      const origins = perm.origins ?? [];
      for (const pattern of origins) {
        await removeEnabledOrigin(pattern);
        cachedBroadcastFilter = null;
        await unregisterDynamicScripts(pattern).catch(() => {});
      }
    });
  }

  if (browser.permissions?.onAdded) {
    browser.permissions.onAdded.addListener(async (perm) => {
      const origins = perm.origins ?? [];
      const enabled = await getEnabledPatterns();
      const enabledSet = new Set(enabled);
      for (const pattern of origins) {
        if (!enabledSet.has(pattern)) continue;
        await registerDynamicScripts(pattern).catch(() => {});
      }
    });
  }

  browser.commands?.onCommand.addListener(async (command) => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (typeof tab?.id !== "number") return;
    if (command === "open_picker") {
      browser.tabs
        .sendMessage(tab.id, { kind: "cmd.openPicker" })
        .catch(() => {});
    } else if (command === "fill_all") {
      browser.tabs.sendMessage(tab.id, { kind: "cmd.fillAll" }).catch(() => {});
    }
  });

  void reconcileRegisteredScripts();
});
