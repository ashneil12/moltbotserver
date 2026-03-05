/**
 * Playwright stealth evasion scripts.
 *
 * Returns a single JavaScript string designed to be injected via
 * `context.addInitScript()`.  This runs before any site JavaScript
 * and patches browser APIs that anti-bot detectors inspect.
 *
 * Evasions included:
 *   1. navigator.webdriver       — force undefined (belt-and-suspenders)
 *   2. navigator.plugins         — spoof a realistic PluginArray
 *   3. navigator.languages       — ensure ['en-US', 'en']
 *   4. chrome.runtime            — stub to hide CDP artifacts
 *   5. Notification.permission   — return 'default' instead of 'denied'
 *   6. WebGL renderer strings    — hide Mesa/llvmpipe software rendering
 *   7. window.chrome             — ensure the chrome object exists
 *   8. iframe contentWindow      — patch cross-origin anomalies
 *
 * Each evasion is wrapped in its own try/catch so a single failure
 * doesn't prevent the others from applying.
 *
 * @see https://github.com/nicholascioli/puppeteer-extra-plugin-stealth
 */

const STEALTH_EVASIONS: string[] = [
  // ── 1. navigator.webdriver ──────────────────────────────────────────
  // Chrome flag --disable-blink-features=AutomationControlled already
  // handles this in most cases, but page scripts can still read the
  // property via Object.getOwnPropertyDescriptor.  Redefine it to be safe.
  `try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
} catch (_) {}`,

  // ── 2. navigator.plugins ────────────────────────────────────────────
  // Real browsers have 3-5 plugins.  Automation returns an empty
  // PluginArray which is a trivial fingerprint.
  `try {
  const fakePlugins = [
    { name: 'Chrome PDF Plugin',        filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
    { name: 'Chrome PDF Viewer',        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
    { name: 'Native Client',            filename: 'internal-nacl-plugin', description: '', length: 2 },
  ];
  const pluginArray = Object.create(PluginArray.prototype);
  fakePlugins.forEach((p, i) => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperties(plugin, {
      name:        { get: () => p.name,        enumerable: true },
      filename:    { get: () => p.filename,    enumerable: true },
      description: { get: () => p.description, enumerable: true },
      length:      { get: () => p.length,      enumerable: true },
    });
    pluginArray[i] = plugin;
  });
  Object.defineProperty(pluginArray, 'length', { get: () => fakePlugins.length });
  Object.defineProperty(navigator, 'plugins', {
    get: () => pluginArray,
    configurable: true,
  });
} catch (_) {}`,

  // ── 3. navigator.languages ──────────────────────────────────────────
  // CDP connections can expose an empty or mismatched languages array.
  `try {
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true,
  });
} catch (_) {}`,

  // ── 4. chrome.runtime ───────────────────────────────────────────────
  // When Playwright connects via CDP it injects a detectable
  // chrome.runtime object.  Replace it with a minimal stub that looks
  // like a normal browser (has connect/sendMessage but they throw the
  // standard "Extension doesn't exist" error).
  `try {
  const runtime = {
    connect: function() {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    },
    sendMessage: function() {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    },
  };
  if (window.chrome) {
    window.chrome.runtime = runtime;
  } else {
    window.chrome = { runtime };
  }
} catch (_) {}`,

  // ── 5. Notification.permission ──────────────────────────────────────
  // Headless / automated browsers return 'denied' by default.
  // Real browsers usually return 'default' (not yet asked).
  `try {
  if (typeof Notification !== 'undefined') {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
      configurable: true,
    });
  }
} catch (_) {}`,

  // ── 6. WebGL renderer strings ───────────────────────────────────────
  // Software rendering exposes "Google Inc." / "Google SwiftShader" or
  // "Mesa" / "llvmpipe" which are dead giveaways for containers/VMs.
  // Spoof to a common Intel integrated GPU.
  `try {
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    // UNMASKED_VENDOR_WEBGL
    if (param === 0x9245) return 'Intel Inc.';
    // UNMASKED_RENDERER_WEBGL
    if (param === 0x9246) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, param);
  };
  // Also patch WebGL2, same constants
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(param) {
      if (param === 0x9245) return 'Intel Inc.';
      if (param === 0x9246) return 'Intel Iris OpenGL Engine';
      return getParameter2.call(this, param);
    };
  }
} catch (_) {}`,

  // ── 7. window.chrome ────────────────────────────────────────────────
  // Ensure window.chrome exists with the app/csi properties that real
  // Chrome exposes.  Some detection scripts check for their existence.
  `try {
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() { return {}; };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() { return {}; };
  }
} catch (_) {}`,

  // ── 8. iframe contentWindow ─────────────────────────────────────────
  // Proxy HTMLIFrameElement.contentWindow to prevent detection scripts
  // from spotting CDP cross-origin artifacts.
  `try {
  const origDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  if (origDesc && origDesc.get) {
    const origGet = origDesc.get;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function() {
        const win = origGet.call(this);
        if (!win) return win;
        // If the iframe's window exposes webdriver, patch it
        try {
          if (win.navigator && win.navigator.webdriver) {
            Object.defineProperty(win.navigator, 'webdriver', {
              get: () => undefined,
              configurable: true,
            });
          }
        } catch (_) {
          // Cross-origin: expected to throw, that's fine
        }
        return win;
      },
      configurable: true,
    });
  }
} catch (_) {}`,
];

/**
 * Build a single JavaScript string containing all stealth evasions.
 *
 * Designed for use with `BrowserContext.addInitScript()`:
 * ```ts
 * context.addInitScript(getStealthScript());
 * ```
 */
export function getStealthScript(): string {
  return STEALTH_EVASIONS.join("\n\n");
}
