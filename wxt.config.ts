import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ mode }) => ({
    name: 'TalentProfile Autofill',
    minimum_chrome_version: '116',
    description: 'Fill job application forms from your TalentProfile.',
    permissions: ['storage', 'tabs', 'webNavigation', 'scripting', 'offscreen'],
    host_permissions: [
      'https://*.myworkdayjobs.com/*',
      'https://boards.greenhouse.io/*',
      'https://job-boards.greenhouse.io/*',
      'https://api.talentprofile.net/*',
      'https://*.talentprofile.net/*',
      'http://localhost:8083/*',
    ],
    optional_host_permissions: ['*://*/*'],
    action: {
      default_title: 'TalentProfile Autofill',
      default_popup: 'popup.html',
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: 'Ctrl+Shift+L',
          mac: 'Command+Shift+L',
        },
        description: 'Open TalentProfile',
      },
      open_picker: {
        description: 'Open TalentProfile picker on focused field',
      },
      fill_all: {
        description: 'Fill all visible fields with TalentProfile',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    externally_connectable: {
      matches: [
        'https://talentprofile.net/*',
        'https://*.talentprofile.net/*',
        ...(mode === 'development' ? ['http://localhost/*'] : []),
      ],
    },
    ...(process.env.WXT_EXTENSION_KEY
      ? { key: process.env.WXT_EXTENSION_KEY }
      : {}),
  }),
  srcDir: 'src',
  vite: () => ({
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
    optimizeDeps: { esbuildOptions: { conditions: ['onnxruntime-web-use-extern-wasm'] } },
  }),
})