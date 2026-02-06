// Node.js shim for browser APIs used by MVMF libraries
import WebSocket from 'ws';

// Use native fetch (Node 18+) or throw helpful error
const doFetch = globalThis.fetch ?? (() => {
  throw new Error('Node.js 18+ required for native fetch support');
});

// XMLHttpRequest shim using fetch
globalThis.XMLHttpRequest = class XMLHttpRequest {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.responseText = '';
    this._onreadystatechange = null;
    this._method = 'GET';
    this._url = '';
    this._headers = {};
    this._async = true;
  }

  get onreadystatechange() {
    return this._onreadystatechange;
  }

  set onreadystatechange(fn) {
    this._onreadystatechange = fn;
  }

  open(method, url, async = true) {
    this._method = method;
    this._url = url;
    this._async = async;
    this.readyState = 1;
  }

  setRequestHeader(name, value) {
    this._headers[name] = value;
  }

  send(body) {
    const options = {
      method: this._method,
      headers: this._headers,
      signal: AbortSignal.timeout(30000),
    };
    if (body && this._method !== 'GET') {
      options.body = body;
    }

    doFetch(this._url, options)
      .then(async (response) => {
        this.status = response.status;
        this.statusText = response.statusText;
        this.responseText = await response.text();
        this.readyState = 4;
        if (this._onreadystatechange) {
          this._onreadystatechange();
        }
      })
      .catch((error) => {
        this.status = 0;
        this.statusText = error.message;
        this.readyState = 4;
        if (this._onreadystatechange) {
          this._onreadystatechange();
        }
      });
  }
};

// Stub navigator for FINGERPRINT class (returns dummy values)
// Node.js v21+ has a built-in read-only navigator, so we extend it
if (typeof globalThis.navigator !== 'undefined') {
  Object.defineProperties(globalThis.navigator, {
    appVersion: { value: '1.0', writable: true, configurable: true },
    appName: { value: 'fabric-mcp', writable: true, configurable: true },
    cookieEnabled: { value: false, writable: true, configurable: true },
    plugins: { value: [], writable: true, configurable: true },
  });
} else {
  globalThis.navigator = {
    userAgent: 'Node.js MCP Client',
    appVersion: '1.0',
    appName: 'fabric-mcp',
    cookieEnabled: false,
    plugins: [],
  };
}

// Stub screen
if (typeof globalThis.screen === 'undefined') {
  globalThis.screen = {
    pixelDepth: 24,
    width: 1920,
    height: 1080,
  };
}

// Stub document (minimal, for FINGERPRINT canvas check)
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    cookie: '',
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          width: 200,
          height: 200,
          getContext: () => ({
            textBaseline: '',
            font: '',
            fillStyle: '',
            strokeStyle: '',
            globalAlpha: 1,
            globalCompositeOperation: '',
            fillRect: () => {},
            fillText: () => {},
            strokeText: () => {},
            beginPath: () => {},
            closePath: () => {},
            arc: () => {},
            fill: () => {},
            stroke: () => {},
            rotate: () => {},
            translate: () => {},
            scale: () => {},
            save: () => {},
            restore: () => {},
            measureText: () => ({ width: 10 }),
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
          }),
          toDataURL: () => 'data:,',
        };
      }
      return {};
    },
    getElementById: () => null,
  };
}

// Stub window
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    location: {
      hostname: 'localhost',
    },
  };
}

// Real WebSocket from 'ws' package
globalThis.WebSocket = WebSocket;

// Stub localStorage/sessionStorage
if (typeof globalThis.localStorage === 'undefined') {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
}

if (typeof globalThis.sessionStorage === 'undefined') {
  const storage = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
}

export {};
