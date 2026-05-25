import { mount, unmount } from "svelte";
import FormFillButton from "./widget/FormFillButton.svelte";
import type { FillCounts } from "~/bridge/types";

type MountOptions = {
  container: HTMLElement;
  anchorRow: HTMLElement;
  onFillClick: () => Promise<FillCounts>;
  onSignInClick: () => Promise<void>;
  onOpenEditorClick: () => Promise<void>;
  isAuthenticated: () => Promise<boolean>;
  isProfileUsable: () => Promise<boolean>;
};

const STYLE_TEXT = `
:host { all: initial; }
.row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin: 0 0 16px 0;
  font: 500 14px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
.wrap {
  position: relative;
  display: inline-block;
}
button.primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #175CFA;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  cursor: pointer;
  letter-spacing: -0.01em;
  transition: background 120ms ease, opacity 120ms ease;
}
button.primary:hover:not(:disabled) { background: #0f4ad6; }
button.primary:disabled { opacity: 0.7; cursor: not-allowed; }
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.tooltip {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 2147483646;
  min-width: 220px;
  max-width: 320px;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 6px;
  padding: 10px 28px 10px 12px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2), 0 2px 4px rgba(15, 23, 42, 0.15);
  font: 400 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  text-align: left;
}
.tooltip-arrow {
  position: absolute;
  top: -5px;
  right: 16px;
  width: 10px;
  height: 10px;
  background: #0f172a;
  transform: rotate(45deg);
}
.tooltip-body {
  position: relative;
  z-index: 1;
}
.dismiss {
  position: absolute;
  top: 4px;
  right: 4px;
  background: transparent;
  border: none;
  color: rgba(248, 250, 252, 0.6);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  z-index: 2;
  font-family: inherit;
}
.dismiss:hover { color: #f8fafc; }
.counts {
  display: flex;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}
.count { font-weight: 500; }
.count-filled { color: #6ee7b7; }
.count-skipped { color: #cbd5e1; }
.count-failed { color: #fca5a5; }
.warning {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(248, 250, 252, 0.15);
  color: #fde68a;
  font-size: 11px;
}
.link {
  background: transparent;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: #93c5fd;
  text-decoration: none;
  font-weight: 600;
  margin-left: 4px;
}
.link:hover { color: #bfdbfe; text-decoration: underline; }
`

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

export const mountFormFillButton = (
  opts: MountOptions,
): { destroy: () => void } => {
  const host = document.createElement("div");
  host.setAttribute("data-tp-form-widget", "true");
  host.style.cssText = "display: block; width: 100%;";
  const shadow = host.attachShadow({ mode: "open" });

  applyStyles(shadow);

  const mountTarget = document.createElement("div");
  shadow.appendChild(mountTarget);

  opts.anchorRow.insertAdjacentElement("beforebegin", host);

  const component = mount(FormFillButton, {
    target: mountTarget,
    props: {
      onFillClick: opts.onFillClick,
      onSignInClick: opts.onSignInClick,
      onOpenEditorClick: opts.onOpenEditorClick,
      isAuthenticated: opts.isAuthenticated,
      isProfileUsable: opts.isProfileUsable,
    },
  });

  return {
    destroy: () => {
      unmount(component);
      host.remove();
    },
  };
};
