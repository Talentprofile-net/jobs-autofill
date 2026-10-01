export const PICKER_PAGE_STYLE = `
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
}
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
  width: 100%;
  box-sizing: border-box;
  max-height: var(--tp-picker-max-height, 320px);
}
html[data-tp-mobile="true"] .popover {
  border-radius: 12px 12px 0 0;
  border-bottom: none;
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
.toast-warn {
  border-top: 1px solid var(--tp-picker-border, hsl(240 5.9% 90%));
  color: hsl(0 72% 35%);
}
.retry-row {
  margin-top: 8px;
}
.signin {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 12px;
}
.signin-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--tp-picker-fg, hsl(240 10% 3.9%));
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
`
