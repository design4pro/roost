import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

/**
 * The public half of the extension's signing key.
 *
 * Its only job is to pin the extension id (bioblgelppeliobebbanmlebifhallik)
 * across every profile that loads this build - Chrome, Chrome Canary, and the
 * Playwright profile. Without it Chrome derives an id from the unpacked path,
 * so the same build gets a different `chrome-extension://` origin in each
 * browser, and `_favicon/` URLs, the dashboard link, and the granted host
 * permission all stop matching between them.
 *
 * Public by design: the private half (roost-extension.pem) stays out of the
 * repo and is only needed to pack a .crx.
 */
const MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAotz4i5C81Nz5W88oE1/+F+V9Oa7kmGvupCv5P2BiL3w35av1+83kq4OPCEM410LSs2ji7dIPVIt3Os7FQgn+rJ7DMaoza/QYRxhfPqc164cCWr33jZ1dpRqjuleb1OHdJ+PxFHb25+f63egLIrnZEo+xolSyqB7ysdq8L4O5roOAtMkHABLi/VaEtSZBy9z4aP6eMI32oAQ0Lme7uNS99HJjQklCI397L3UDspdfXCFXnFVNK0EvQMzlPT5z6bXb5aHjyj7ABWpmnqJ/8uu3Mmxo5tFPoY+vh0pGludc+AlpuGpdxp7Efm+Ld+ATb6f0W954Ne0dmGJsvhvRFotcIwIDAQAB'

export default defineConfig({
  srcDir: 'src/extension',
  // Stated rather than left to the default, which resolves against the repo
  // root and would leave `_locales` out of the build.
  publicDir: 'src/extension/public',
  modules: ['@wxt-dev/module-react'],

  // Auto-imports are off: every symbol is imported by name, so the layering
  // rules in eslint.config.js can see the dependency and tsc can check it.
  imports: false,
  vite: () => ({ plugins: [tailwindcss()] }),

  // WXT's own browser launcher would open a throwaway profile. Chrome and
  // Canary are loaded by hand here (chrome://extensions, "Load unpacked"),
  // because the point of this project is two real browsers with real sessions.
  webExt: { disabled: true },

  manifest: ({ mode }) => ({
    name: 'Roost',
    description: '__MSG_extension_description__',
    default_locale: 'en',
    // `folderType` and `syncing` on bookmark roots, which bookmarks/mirror.ts
    // classifies roots by instead of the legacy '1'/'2' ids.
    minimum_chrome_version: '134',
    key: MANIFEST_KEY,
    // No default_popup: clicking the toolbar icon fires action.onClicked, which
    // focuses the dashboard tab or opens one.
    action: {},
    permissions: [
      'tabs',
      'tabGroups',
      'bookmarks',
      'storage',
      'unlimitedStorage',
      'alarms',
      'favicon',
    ],
    // The Worker's host is only known at onboarding, so it is requested at
    // runtime. Nothing about the pairing key needs the request to be same-site;
    // the permission is what lets the extension reach the host at all.
    optional_host_permissions: ['https://*/*'],
    // The e2e build talks to `wrangler dev` instead, and cannot stop to ask.
    ...(mode === 'e2e'
      ? { host_permissions: ['http://localhost:3011/*'] }
      : {}),
  }),
})
