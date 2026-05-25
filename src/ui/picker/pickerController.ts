import { mount, unmount } from "svelte";
import {
  computePosition,
  flip,
  shift,
  offset,
  autoUpdate,
  size,
} from "@floating-ui/dom";
import PickerPopover from "./PickerPopover.svelte";
import {
  applyAppearanceVars,
  findIconDonor,
  readDonorAppearance,
} from "~/ui/donorStyle";

export type PickerContext = {
  anchor: HTMLElement;
  triggerElement?: HTMLElement;
  field: HTMLElement;
  fieldUuid: string;
  fieldName: string;
  fieldType: string;
  section: string;
  pickerMode: import("~/field/types").PickerMode;
};

type ActivePicker = {
  ctx: PickerContext;
  host: HTMLElement;
  cleanup: () => void;
  previousFocus: HTMLElement | null;
};

let active: ActivePicker | null = null;

const MIN_POPOVER_WIDTH = 280;
const MAX_POPOVER_WIDTH = 480;
const POPOVER_OFFSET = 6;
const MIN_POPOVER_MAX_HEIGHT = 320;
const MOBILE_CLOSE_ANIMATION_MS = 240;

const STYLE_TEXT = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
}
:host([data-tp-mobile="true"]) {
  position: fixed;
  inset: 0;
}
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  pointer-events: auto;
  opacity: 0;
  transition: opacity 160ms ease;
}
.backdrop[data-tp-shown="true"] { opacity: 1; }
.popover {
  pointer-events: auto;
  background: var(--tp-picker-bg, hsl(0 0% 100%));
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
  border: 1px solid var(--tp-picker-border, hsl(240 5.9% 90%));
  border-radius: 8px;
  font: 400 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: fixed;
  width: ${MIN_POPOVER_WIDTH}px;
  max-height: ${MIN_POPOVER_MAX_HEIGHT}px;
}
:host([data-tp-mobile="true"]) .popover {
  position: fixed !important;
  left: 0 !important;
  right: 0 !important;
  top: auto !important;
  bottom: 0;
  width: 100% !important;
  max-width: none !important;
  max-height: 70vh !important;
  border-radius: 12px 12px 0 0;
  border-bottom: none;
  transform: translateY(100%);
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
:host([data-tp-mobile="true"][data-tp-shown="true"]) .popover {
  transform: translateY(0);
}
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 12px;
  border-bottom: 1px solid var(--tp-picker-border, hsl(240 5.9% 90%));
  flex-shrink: 0;
}
.header-logo {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--tp-picker-fg-muted, hsl(240 3.8% 46.1%));
  flex-shrink: 0;
  transition: background 100ms ease, color 100ms ease;
  line-height: 0;
}
.icon-btn:hover {
  background: var(--tp-picker-hover, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
}
.icon-btn[data-tp-active="true"] {
  background: var(--tp-picker-hover, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
}
.icon-btn svg { display: block; }
.title {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.005em;
}
.search-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--tp-picker-border, hsl(240 5.9% 90%));
  flex-shrink: 0;
  overflow: hidden;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  border-bottom-width: 0;
  transition: max-height 180ms ease, padding 180ms ease, border-bottom-width 180ms ease;
}
.search-row[data-tp-shown="true"] {
  max-height: 56px;
  padding-top: 8px;
  padding-bottom: 8px;
  border-bottom-width: 1px;
}
.search {
  border: 1px solid var(--tp-picker-border, hsl(240 5.9% 90%));
  border-radius: 6px;
  padding: 6px 10px;
  font: 400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
  background: var(--tp-picker-bg, hsl(0 0% 100%));
  width: 100%;
  outline: none;
  box-sizing: border-box;
  transition: border-color 100ms ease, box-shadow 100ms ease;
}
.search:focus {
  border-color: hsl(240 5% 64.9%);
  box-shadow: 0 0 0 3px hsl(240 4.8% 95.9%);
}
.search::placeholder { color: hsl(240 3.8% 46.1%); }
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}
.section-header {
  font-size: 11px;
  font-weight: 600;
  color: hsl(240 3.8% 46.1%);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 8px 8px 4px;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  font: 400 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
  box-sizing: border-box;
  border-radius: 6px;
  transition: background 80ms ease;
}
.item:hover, .item[data-tp-active="true"] {
  background: var(--tp-picker-hover, color-mix(in srgb, currentColor 6%, transparent));
}
.item[data-tp-flash="true"] {
  background: hsl(142 71% 95%);
  animation: tp-flash 1600ms ease-out forwards;
}
@keyframes tp-flash {
  0% { background: hsl(142 71% 90%); }
  100% { background: transparent; }
}
.item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(240 3.8% 46.1%);
  line-height: 0;
  flex-shrink: 0;
}
.item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.item-label .label-text {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.item-label .value {
  display: block;
  color: hsl(240 3.8% 46.1%);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
  font-weight: 400;
}
.item-chevron {
  color: hsl(240 3.8% 46.1%);
  font-size: 13px;
  flex-shrink: 0;
  line-height: 0;
}
.item-chevron svg { transform: rotate(0deg); }
.empty {
  padding: 24px 16px;
  text-align: center;
  color: hsl(240 3.8% 46.1%);
  font-size: 12px;
  line-height: 1.5;
}
.item-wrap {
  position: relative;
  overflow: hidden;
  transform: translateX(0);
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
.item-wrap[data-tp-revealed="true"] {
  transform: translateX(-96px);
}
.item-with-actions {
  position: relative;
  z-index: 1;
  background: var(--tp-picker-bg, hsl(0 0% 100%));
}
.item-wrap:not([data-tp-revealed="true"]) .item-with-actions {
  transform: translateX(var(--tp-swipe-offset, 0));
}
.row-actions {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  z-index: 2;
}
.row-actions[data-tp-visible="false"] {
  display: none;
}
.item-wrap:hover .row-actions,
.item-wrap:focus-within .row-actions {
  opacity: 1;
  pointer-events: auto;
}
.item-with-actions[data-tp-active="true"] ~ .row-actions {
  opacity: 1;
  pointer-events: auto;
}
.item-wrap[data-tp-revealed="true"] .row-actions {
  opacity: 1;
  pointer-events: auto;
}
.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: var(--tp-picker-bg, hsl(0 0% 100%));
  color: hsl(240 3.8% 46.1%);
  cursor: pointer;
  transition: background 80ms ease, color 80ms ease;
  box-shadow: 0 0 0 1px var(--tp-picker-border, hsl(240 5.9% 90%));
}
.row-action:hover {
  background: var(--tp-picker-hover, color-mix(in srgb, currentColor 6%, transparent));
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
}
.row-action-delete:hover {
  color: hsl(0 72% 51%);
  background: hsl(0 86% 97%);
  box-shadow: 0 0 0 1px hsl(0 86% 90%);
}
.row-action svg { display: block; }
.confirm-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: hsl(0 86% 97%);
  border: 1px solid hsl(0 86% 92%);
  border-radius: 6px;
  margin: 2px 4px;
}
.confirm-text {
  font-size: 12px;
  color: hsl(0 72% 35%);
  font-weight: 500;
}
.confirm-buttons {
  display: flex;
  gap: 6px;
}
.confirm-btn {
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}
.confirm-cancel {
  background: var(--tp-picker-bg, hsl(0 0% 100%));
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
  border-color: var(--tp-picker-border, hsl(240 5.9% 90%));
}
.confirm-cancel:hover {
  background: var(--tp-picker-hover, color-mix(in srgb, currentColor 6%, transparent));
}
.confirm-yes {
  background: hsl(0 72% 51%);
  color: hsl(0 0% 100%);
}
.confirm-yes:hover {
  background: hsl(0 72% 45%);
}
.confirm-error {
  font-size: 11px;
  color: hsl(0 72% 35%);
}
.compose {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  flex: 1;
  min-height: 0;
}
.compose textarea {
  flex: 1;
  min-height: 120px;
  resize: none;
  border: 1px solid var(--tp-picker-border, hsl(240 5.9% 90%));
  border-radius: 6px;
  padding: 8px 10px;
  font: 400 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
  background: var(--tp-picker-bg, hsl(0 0% 100%));
  outline: none;
  box-sizing: border-box;
  transition: border-color 100ms ease, box-shadow 100ms ease;
}
.compose textarea:focus {
  border-color: hsl(240 5% 64.9%);
  box-shadow: 0 0 0 3px hsl(240 4.8% 95.9%);
}
.compose-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: hsl(240 3.8% 46.1%);
}
.compose-meta .over { color: hsl(0 72% 51%); font-weight: 500; }
.compose-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.btn {
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  padding: 7px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}
.btn-primary {
  background: hsl(240 5.9% 10%);
  color: hsl(0 0% 98%);
}
.btn-primary:hover:not(:disabled) { background: hsl(240 5% 26%); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  background: var(--tp-picker-bg, hsl(0 0% 100%));
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
  border-color: var(--tp-picker-border, hsl(240 5.9% 90%));
}
.btn-secondary:hover { background: var(--tp-picker-hover, color-mix(in srgb, currentColor 6%, transparent)); }
.compose-error {
  color: hsl(0 72% 51%);
  font-size: 11px;
}
`;

const supportsAdoptedStyleSheets =
  typeof CSSStyleSheet !== "undefined" &&
  "replaceSync" in CSSStyleSheet.prototype &&
  "adoptedStyleSheets" in Document.prototype;

const sharedSheet: CSSStyleSheet | null = supportsAdoptedStyleSheets
  ? (() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE_TEXT);
      return sheet;
    })()
  : null;

const applyStyles = (shadow: ShadowRoot): void => {
  if (sharedSheet) {
    (
      shadow as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }
    ).adoptedStyleSheets = [sharedSheet];
    return;
  }
  const styleEl = document.createElement("style");
  styleEl.textContent = STYLE_TEXT;
  shadow.appendChild(styleEl);
};

const isMobileViewport = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
};

const computeAnchorWidth = (anchor: HTMLElement): number => {
  const rect = anchor.getBoundingClientRect();
  const w = Math.round(rect.width);
  if (w < MIN_POPOVER_WIDTH) return MIN_POPOVER_WIDTH;
  if (w > MAX_POPOVER_WIDTH) return MAX_POPOVER_WIDTH;
  return w;
};

const restoreFocus = (el: HTMLElement | null): void => {
  if (!el) return;
  if (!document.documentElement.contains(el)) return;
  try {
    el.focus({ preventScroll: true });
  } catch {}
};

export const closePicker = (): void => {
  if (!active) return;
  const current = active;
  active = null;

  const mobile = current.host.getAttribute("data-tp-mobile") === "true";
  current.host.setAttribute("data-tp-shown", "false");

  const finalize = () => {
    current.cleanup();
    current.host.remove();
    restoreFocus(current.previousFocus);
  };

  if (mobile) {
    setTimeout(finalize, MOBILE_CLOSE_ANIMATION_MS);
  } else {
    finalize();
  }
};

const findCompositionScope = (anchor: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = anchor.parentElement;
  let depth = 0;
  while (node && depth < 10) {
    const buttons = node.querySelectorAll("button, [role='button']");
    if (buttons.length > 0) return node;
    node = node.parentElement;
    depth++;
  }
  return null;
};

export const openPicker = (ctx: PickerContext): void => {
  closePicker();

  const host = document.createElement("div");
  host.setAttribute("data-tp-picker", "true");
  const mobile = isMobileViewport();
  host.setAttribute("data-tp-mobile", mobile ? "true" : "false");
  host.setAttribute("data-tp-shown", "false");

  const shadow = host.attachShadow({ mode: "open" });
  applyStyles(shadow);

  const mountTarget = document.createElement("div");
  shadow.appendChild(mountTarget);
  document.body.appendChild(host);

  const scope = findCompositionScope(ctx.anchor);
  if (scope) {
    const donor = findIconDonor(scope, ctx.triggerElement ?? null);
    const appearance = readDonorAppearance(donor, scope);
    applyAppearanceVars(host, appearance, "tp-picker");
  }

  const previousFocus = (document.activeElement as HTMLElement | null) ?? null;

  const onClose = () => closePicker();

  const component = mount(PickerPopover, {
    target: mountTarget,
    props: { ctx, onClose, mobile },
  });

  requestAnimationFrame(() => {
    host.setAttribute("data-tp-shown", "true");
  });

  let cleanupFloating: (() => void) | null = null;

  if (!mobile) {
    const popoverEl = shadow.querySelector(".popover") as HTMLElement | null;
    if (popoverEl) {
      const reference = ctx.triggerElement ?? ctx.anchor;
      const w = computeAnchorWidth(ctx.anchor);
      popoverEl.style.width = `${w}px`;

      const updatePosition = async () => {
        const el = shadow.querySelector(".popover") as HTMLElement | null;
        if (!el) return;
        const { x, y, placement } = await computePosition(reference, el, {
          placement: "top-end",
          middleware: [
            offset(POPOVER_OFFSET),
            flip({ fallbackPlacements: ["bottom-end", "top-start", "bottom-start"] }),
            shift({ padding: 8 }),
            size({
              padding: 8,
              apply({ availableHeight, elements }) {
                const cap = Math.max(
                  MIN_POPOVER_MAX_HEIGHT,
                  Math.min(520, availableHeight),
                );
                (elements.floating as HTMLElement).style.maxHeight = `${cap}px`;
              },
            }),
          ],
        });
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.setAttribute("data-tp-placement", placement);
      };

      cleanupFloating = autoUpdate(reference, popoverEl, updatePosition);
    }
  }

  const handleOutsideClick = (e: MouseEvent) => {
    if (host.contains(e.target as Node)) return;
    if (ctx.anchor.contains(e.target as Node)) return;
    if (ctx.triggerElement && ctx.triggerElement.contains(e.target as Node)) return;
    closePicker();
  };
  const handleHostKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closePicker();
    e.stopPropagation();
  };
  document.addEventListener("mousedown", handleOutsideClick, true);
  host.addEventListener("keydown", handleHostKeydown);

  active = {
    ctx,
    host,
    previousFocus,
    cleanup: () => {
      document.removeEventListener("mousedown", handleOutsideClick, true);
      host.removeEventListener("keydown", handleHostKeydown);
      cleanupFloating?.();
      unmount(component);
    },
  };
};