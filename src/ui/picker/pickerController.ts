import { browser } from "wxt/browser";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from "@floating-ui/dom";
import type { FieldDescriptor } from "~/bridge/types";
import type { ProfileValue } from "~/field/types";
import { readOptionLabels } from "~/capture/optionLabels";
import { findIconDonor, readDonorAppearance } from "~/ui/donorStyle";
import { insertIntoField } from "./insertion";
import {
  PICKER_PAGE,
  type PickerAction,
  type PickerConfirmContext,
  type PickerContextData,
  type PickerFieldContext,
  type PickerSignal,
} from "./protocol";

export type PickerTarget = {
  descriptor: FieldDescriptor;
  field: HTMLElement;
  anchor: HTMLElement;
  trigger: HTMLElement | null;
};

type FrameAnchor = {
  anchor: HTMLElement;
  trigger: HTMLElement | null;
};

type PickerHost = {
  id: string;
  host: HTMLElement;
  frame: HTMLIFrameElement;
  backdrop: HTMLElement;
  ready: boolean;
};

type ActivePicker = {
  activation: string;
  mobile: boolean;
  target: PickerTarget | null;
  onConfirm: (() => void) | null;
  onDismiss: (() => void) | null;
  context: PickerContextData;
  maxHeight: number;
  cleanup: () => void;
  previousFocus: HTMLElement | null;
};

let pickerHost: PickerHost | null = null;
let active: ActivePicker | null = null;

const MIN_POPOVER_WIDTH = 280;
const MAX_POPOVER_WIDTH = 480;
const POPOVER_OFFSET = 6;
const MIN_POPOVER_MAX_HEIGHT = 320;
const MAX_POPOVER_MAX_HEIGHT = 520;
const MOBILE_MAX_HEIGHT_RATIO = 0.7;
const PARKED = "-10000px";

const HOST_STYLE = `
:host {
  all: initial;
  position: fixed;
  inset: 0 auto auto 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
}
iframe {
  position: fixed;
  border: 0;
  margin: 0;
  padding: 0;
  background: transparent;
  color-scheme: normal;
  visibility: hidden;
  clip-path: inset(0 round 1px);
}
iframe[data-tp-ready="true"] { visibility: visible; }
iframe[data-tp-mobile="true"] {
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
}
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
}
`;

const isMobileViewport = (): boolean =>
  window.matchMedia("(pointer: coarse) and (hover: none)").matches;

const clampWidth = (anchor: HTMLElement): number => {
  const w = Math.round(anchor.getBoundingClientRect().width);
  return Math.min(MAX_POPOVER_WIDTH, Math.max(MIN_POPOVER_WIDTH, w));
};

const storageKeyFor = (): string => {
  const cleaned = location.pathname.replace(/\/+$/, "").replace(/^\//, "");
  const segment = cleaned ? cleaned.split("/").slice(0, 3).join("/") : "root";
  return `tp.picker.path.${location.hostname}.${segment || "root"}`;
};

const findCompositionScope = (anchor: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = anchor.parentElement;
  let depth = 0;
  while (node && depth < 10) {
    if (node.querySelectorAll("button, [role='button']").length > 0) return node;
    node = node.parentElement;
    depth++;
  }
  return null;
};

const restoreFocus = (el: HTMLElement | null): void => {
  if (!el || !document.documentElement.contains(el)) return;
  try {
    el.focus({ preventScroll: true });
  } catch {}
};

const signal = (message: PickerSignal): void => {
  browser.runtime.sendMessage(message).catch(() => {});
};

const activate = (host: PickerHost, activation: string): void =>
  signal({ activation, hostId: host.id, kind: "picker.activate" });

const ensureHost = (): PickerHost => {
  if (pickerHost?.host.isConnected && pickerHost.host.ownerDocument === document) return pickerHost;
  const id = crypto.randomUUID();
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = HOST_STYLE;
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.style.display = "none";
  backdrop.addEventListener("click", () => closePicker());
  const frame = document.createElement("iframe");
  frame.src = `${browser.runtime.getURL(PICKER_PAGE)}#${id}`;
  shadow.append(style, backdrop, frame);
  pickerHost = { backdrop, frame, host, id, ready: false };
  disableHost(pickerHost);
  document.documentElement.appendChild(host);
  return pickerHost;
};

const disableHost = ({ backdrop, frame, host }: PickerHost): void => {
  host.inert = true;
  backdrop.style.display = "none";
  frame.inert = true;
  frame.setAttribute("aria-hidden", "true");
  frame.removeAttribute("data-tp-ready");
  frame.style.pointerEvents = "none";
  frame.style.height = "0px";
  frame.style.left = PARKED;
  frame.style.top = PARKED;
};

const enableHost = ({ backdrop, frame, host }: PickerHost, mobile: boolean): void => {
  host.inert = false;
  backdrop.style.display = mobile ? "" : "none";
  frame.inert = false;
  frame.removeAttribute("aria-hidden");
  frame.style.pointerEvents = "";
  frame.setAttribute("data-tp-ready", "true");
};

export const isPickerOpen = (): boolean => active !== null;

export const closePicker = (): void => {
  if (!active) return;
  const current = active;
  if (pickerHost) {
    disableHost(pickerHost);
    pickerHost.host.removeAttribute("data-tp-open");
  }
  active = null;
  current.cleanup();
  if (pickerHost) {
    signal({ activation: current.activation, hostId: pickerHost.id, kind: "picker.deactivate" });
  }
  restoreFocus(current.previousFocus);
  current.onDismiss?.();
};

const frameLayout = (anchor: FrameAnchor) => {
  const mobile = isMobileViewport();
  const scope = findCompositionScope(anchor.anchor);
  const appearance = scope
    ? readDonorAppearance(findIconDonor(scope, anchor.trigger), scope)
    : null;
  const maxHeight = mobile
    ? Math.round(window.innerHeight * MOBILE_MAX_HEIGHT_RATIO)
    : MIN_POPOVER_MAX_HEIGHT;
  return { appearance, maxHeight, mobile };
};

export const openPicker = (target: PickerTarget): void => {
  closePicker();
  const layout = frameLayout(target);
  const context: PickerFieldContext = {
    ...layout,
    descriptor: target.descriptor,
    kind: "field",
    optionLabels: readOptionLabels(target.field),
    storageKey: storageKeyFor(),
  };
  showFrame({ anchor: target, context, onConfirm: null, onDismiss: null, target, title: "Insert from TalentProfile" });
};

export const openFillConfirm = (options: {
  anchor: HTMLElement;
  onConfirm: () => void;
  onDismiss: () => void;
}): void => {
  closePicker();
  const anchor: FrameAnchor = { anchor: options.anchor, trigger: null };
  const context: PickerConfirmContext = { ...frameLayout(anchor), kind: "confirmFill" };
  showFrame({
    anchor,
    context,
    onConfirm: options.onConfirm,
    onDismiss: options.onDismiss,
    target: null,
    title: "Fill this form with TalentProfile",
  });
};

const showFrame = (options: {
  anchor: FrameAnchor;
  context: PickerContextData;
  onConfirm: (() => void) | null;
  onDismiss: (() => void) | null;
  target: PickerTarget | null;
  title: string;
}): void => {
  const { anchor: target, context } = options;
  const { maxHeight, mobile } = context;
  const activation = crypto.randomUUID();
  const picker = ensureHost();
  const { frame, host } = picker;

  disableHost(picker);
  frame.setAttribute("title", options.title);
  frame.setAttribute("data-tp-mobile", mobile ? "true" : "false");
  frame.style.width = mobile ? "" : `${clampWidth(target.anchor)}px`;
  frame.style.left = "";
  frame.style.top = "";
  host.setAttribute("data-tp-open", "true");

  const previousFocus = (document.activeElement as HTMLElement | null) ?? null;

  let cleanupFloating: (() => void) | null = null;
  if (!mobile) {
    const reference = target.trigger ?? target.anchor;
    const update = async () => {
      const { x, y } = await computePosition(reference, frame, {
        middleware: [
          offset(POPOVER_OFFSET),
          flip({ fallbackPlacements: ["bottom-end", "top-start", "bottom-start"] }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight }) {
              const cap = Math.max(
                MIN_POPOVER_MAX_HEIGHT,
                Math.min(MAX_POPOVER_MAX_HEIGHT, Math.round(availableHeight)),
              );
              if (active?.activation === activation && active.maxHeight !== cap) {
                active.maxHeight = cap;
                signal({ activation, hostId: picker.id, kind: "picker.layout", maxHeight: cap });
              }
            },
          }),
        ],
        placement: "top-end",
        strategy: "fixed",
      });
      if (active?.activation !== activation) return;
      frame.style.left = `${x}px`;
      frame.style.top = `${y}px`;
    };
    cleanupFloating = autoUpdate(reference, frame, update);
  }

  const handleOutsideMouseDown = (e: MouseEvent) => {
    const node = e.target as Node;
    if (host.contains(node)) return;
    if (target.anchor.contains(node)) return;
    if (target.trigger && target.trigger.contains(node)) return;
    closePicker();
  };
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") closePicker();
  };
  document.addEventListener("mousedown", handleOutsideMouseDown, true);
  document.addEventListener("keydown", handleEscape, true);

  active = {
    activation,
    cleanup: () => {
      document.removeEventListener("mousedown", handleOutsideMouseDown, true);
      document.removeEventListener("keydown", handleEscape, true);
      cleanupFloating?.();
    },
    context,
    maxHeight,
    mobile,
    onConfirm: options.onConfirm,
    onDismiss: options.onDismiss,
    previousFocus,
    target: options.target,
  };
  if (picker.ready) activate(picker, activation);
};

export const handlePickerAction = (
  hostId: string,
  activation: string | null,
  action: PickerAction,
  fillField: (fieldUuid: string, value: ProfileValue) => void,
): unknown => {
  if (!pickerHost || pickerHost.id !== hostId) return null;
  if (action.type === "ready") {
    pickerHost.ready = true;
    if (active) activate(pickerHost, active.activation);
    return { ok: true };
  }
  if (!active || active.activation !== activation) return null;
  const current = active;
  if (action.type === "context") return { ok: true, data: current.context };
  if (action.type === "insert") {
    if (!current.target) return { ok: false, error: "Not a field picker" };
    return { ok: true, data: insertIntoField(current.target.field, action.text) };
  }
  if (action.type === "fill") {
    if (!current.target) return { ok: false, error: "Not a field picker" };
    fillField(current.target.descriptor.fieldUuid, action.value);
    return { ok: true };
  }
  if (action.type === "confirmFill") {
    if (!current.onConfirm) return { ok: false, error: "Not a fill confirmation" };
    const confirm = current.onConfirm;
    current.onConfirm = null;
    current.onDismiss = null;
    closePicker();
    confirm();
    return { ok: true };
  }
  if (action.type === "dismiss") {
    closePicker();
    return { ok: true };
  }
  const height = Math.max(0, Math.min(Math.round(action.height), current.maxHeight));
  pickerHost.frame.style.height = `${height}px`;
  if (height > 0) enableHost(pickerHost, current.mobile);
  return { ok: true };
};
