# Mobile Deep Link & Wallet Connection Guide

How the inscribed wallet modules handle mobile wallets, deep links, in-app browsers, and how to integrate them into your own app.

---

## Table of Contents

1. [How Mobile Wallet Connection Works](#how-mobile-wallet-connection-works)
2. [Connection Models](#connection-models)
3. [Device Detection](#device-detection)
4. [Deep Link Architecture](#deep-link-architecture)
5. [Per-Wallet Deep Link Behaviour](#per-wallet-deep-link-behaviour)
6. [Connection Strategies](#connection-strategies)
7. [Auto-Reconnect After Redirect](#auto-reconnect-after-redirect)
8. [Embedding in Your App — Quick Start](#embedding-in-your-app--quick-start)
9. [Configuring Custom Deep Links](#configuring-custom-deep-links)
10. [Building a Wallet Picker UI](#building-a-wallet-picker-ui)
11. [Tablet & Hybrid Devices](#tablet--hybrid-devices)
12. [Security Considerations](#security-considerations)
13. [Troubleshooting](#troubleshooting)

---

## How Mobile Wallet Connection Works

On **desktop**, Bitcoin wallets inject a JavaScript provider object into the page (e.g. `window.unisat`, `window.BitcoinProvider`). Your code calls methods on that object directly.

On **mobile**, the situation is different. Most users have wallet apps installed natively, not as browser extensions. Two patterns bridge the gap:

| Pattern | How it works | Wallets |
|---|---|---|
| **In-app browser** | Your deep link opens the wallet app, which loads your dApp URL inside its own embedded browser. The wallet injects its provider into that webview. | Xverse, Phantom |
| **URI-scheme RPC bridge** | A custom URI scheme (`unisat://request?...`) sends a method+params payload to the wallet app. The wallet processes the request and may callback via a return URI. | UniSat |

The inscribed wallet code handles both patterns transparently through a set of exported helpers.

---

## Connection Models

```
┌──────────────────────────────────────────────────────────┐
│                    Desktop Flow                          │
│                                                          │
│  Your Page ──► window.unisat / window.BitcoinProvider    │
│            ──► provider.request('connect')                │
│            ◄── { address, publicKey }                     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│            Mobile: In-App Browser Flow                   │
│                (Xverse, Phantom)                         │
│                                                          │
│  Normal Browser                    Wallet App            │
│  ─────────────                    ──────────             │
│  1. User taps "Connect Xverse"                           │
│  2. window.location.href =                               │
│     "https://connect.xverse.app                          │
│      /browser?url=<your-dapp>"  ──►  Opens in-app browser│
│                                      loads your-dapp URL │
│                                 3. Wallet injects provider│
│                                 4. tryMobileAutoReconnect │
│                                    detects pending wallet │
│                                    calls connect()        │
│                                 ◄── { address, publicKey }│
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│        Mobile: URI-Scheme RPC Bridge Flow                │
│                    (UniSat)                               │
│                                                          │
│  Normal Browser                    UniSat App            │
│  ─────────────                    ───────────            │
│  1. User taps "Connect UniSat"                           │
│  2. window.location.href =                               │
│     "unisat://request?method=                            │
│      openDapp&data=<b64 URL>"   ──►  Wallet opens dApp  │
│                                      in its own browser  │
│                                 3. window.unisat injected │
│                                 4. Normal connect() works │
└──────────────────────────────────────────────────────────┘
```

---

## Device Detection

The wallet module exports four detection helpers. Use them to decide which UI to show:

```js
import {
  isMobileDevice,
  isTabletDevice,
  isHybridDevice,
  getDeviceType        // → 'desktop' | 'phone' | 'tablet' | 'hybrid'
} from '/r/sat/534764996703784/at/-1/content';
```

**Detection covers:**
- `userAgentData` API (Chromium 93+) — most reliable
- Standard UA string patterns (Android, iPhone, iPad, etc.)
- Samsung Internet browser (always a Samsung device, even in desktop mode)
- iPadOS 13+ masquerading as Mac (touch-point heuristic)
- Amazon Silk browser (Fire tablets)
- Samsung DeX / desktop-mode phones

---

## Deep Link Architecture

### Built-in Deep Links

```
Phantom  → https://phantom.app/ul/browse/<encoded-url>?ref=<origin>
Xverse   → https://connect.xverse.app/browser?url=<encoded-url>
UniSat   → unisat://request?method=openDapp&from=unisat&nonce=<n>&data=<base64>
OKX      → (not shipped by default — configure at runtime)
```

### How Deep Links Are Resolved

1. **Runtime override** — `window.NEXUS_MOBILE_WALLET_DEEPLINKS[walletName]`
2. **localStorage** — `nexus.mobileWalletDeepLinks.v1`
3. **Built-in defaults** — `DEFAULT_MOBILE_DEEPLINKS` in the wallet-connect module

A deep link can be either:
- A **function** `(targetUrl) => deepLinkString`
- A **string template** with `{url}` placeholder, e.g. `'myscheme://browse?url={url}'`

### URL Scheme Security

Every generated deep link is validated against an allowed-scheme list before being used:

- Default allowed: `https` (for all wallets), `unisat` (for UniSat), `okx` (for OKX)
- Runtime extension: `window.NEXUS_MOBILE_WALLET_ALLOWED_SCHEMES`
- Blocked: `javascript:`, `data:`, `vbscript:` — always rejected

---

## Per-Wallet Deep Link Behaviour

### Xverse (In-App Browser)

Xverse opens your URL inside its embedded browser and injects its sats-connect–compatible provider at `window.XverseProviders.BitcoinProvider` or via the `btc_providers` array.

```
https://connect.xverse.app/browser?url=https%3A%2F%2Fyourdapp.com
```

After redirect, the wallet provider is injected and `tryMobileAutoReconnect()` automatically calls `connect()`.

### Phantom (In-App Browser)

Phantom uses a universal link that opens the built-in browser:

```
https://phantom.app/ul/browse/https%3A%2F%2Fyourdapp.com?ref=https%3A%2F%2Fyourdapp.com
```

Provider is injected at `window.phantom.bitcoin`.

### UniSat (URI-Scheme RPC)

UniSat uses a custom `unisat://` scheme. The `openDapp` method tells UniSat to load your URL:

```
unisat://request?method=openDapp&from=unisat&nonce=abc123&data=<base64(["https://yourdapp.com"])>
```

For signing operations, UniSat also supports method-level deep links:

```js
import { getUniSatMobileRequestUrl } from '...wallet-connect...';

// Build a deep link for signPsbt
const url = getUniSatMobileRequestUrl('signPsbt', [psbtHex, options]);
```

### OKX

OKX deep links are **not shipped by default** because their behavior varies across platform versions. Configure at runtime if you have confirmed working links for your target platform.

---

## Connection Strategies

### `connectSmart(walletName, options?)` — Recommended for Most Apps

Smart connection that handles desktop and mobile automatically:

```js
import { connectSmart } from '...wallet-connect...';

try {
  const result = await connectSmart('Xverse');

  if (result.redirected) {
    // User was redirected to the wallet's in-app browser.
    // Page will reload there — tryMobileAutoReconnect() handles the rest.
    return;
  }

  // Normal desktop connection
  console.log('Connected:', result.address);
} catch (err) {
  console.error('Connection failed:', err.message);
}
```

**Behavior:**
- **Desktop:** calls `connect()` directly via injected provider.
- **Mobile:** tries `connect()` first (works if already in a wallet's in-app browser). If the provider isn't injected, falls back to `openMobileWallet()` deep link.

### `connectWithStrategy(walletName, options?)` — Full Control

For apps that need explicit control over the connection method:

```js
import { connectWithStrategy } from '...wallet-connect...';

// Let the module decide
const result = await connectWithStrategy('Xverse', { strategy: 'auto' });

// Force extension/injected provider
const result = await connectWithStrategy('UniSat', { strategy: 'extension' });

// Force deep link redirect
const result = await connectWithStrategy('Xverse', { strategy: 'app' });

// Probe what's available (useful for building UI)
const probe = await connectWithStrategy('Xverse', { strategy: 'probe' });
// probe = { walletName, extension: bool, deepLink: string|null, deviceType, recommended }
```

### `connect(walletName)` — Desktop Only

Direct injected-provider connection. Throws if the provider isn't found. Use this if you know you're on desktop or already inside an in-app browser.

---

## Auto-Reconnect After Redirect

When `openMobileWallet()` redirects the user, it saves the wallet name in `sessionStorage` (`nexus.pendingMobileWallet`). When the page loads inside the wallet's in-app browser, call:

```js
import { tryMobileAutoReconnect } from '...wallet-connect...';

// Call early on page load (e.g. in your app's init or root useEffect)
const provider = await tryMobileAutoReconnect();
if (provider) {
  // Wallet is connected — ready to sign, send, etc.
}
```

**What it does:**
1. Reads `nexus.pendingMobileWallet` from sessionStorage
2. Clears it immediately (no retry loops on error)
3. Polls for up to ~5 seconds for the wallet provider to inject (mobile webviews can be slow)
4. Calls `connect()` once the provider is detected
5. Returns the connected provider, or `null` if nothing was pending

---

## Embedding in Your App — Quick Start

### 1. Import the Wallet Connect Module

There are **two ways** to access the mobile deep-link functions from on-chain code:

#### Option A: Direct import from the wallet-connect inscription (recommended)

```js
import {
  connectSmart,
  tryMobileAutoReconnect,
  connectWithStrategy,
  probeConnectionMethods,
  probeAllWallets,
  openMobileWallet,
  getDeviceType,
  isMobileDevice,
  isTabletDevice,
  isHybridDevice,
  listMobileWalletOptions,
  detectWallets,
  getState,
  subscribe,
  disconnect
} from '/r/sat/534764996703784/at/-1/content';
```

This is `12-wallet-connect.js` — the aggregator module that bundles all providers and exports every mobile helper as a named export.

#### Option B: Via the Nexus Loader

The Nexus Loader (sat `534764996708771`) re-exports the wallet-connect module as `NexusWalletConnect`:

```js
const { NexusWalletConnect } = await import('/r/sat/534764996708771/at/-1/content');

NexusWalletConnect.connectSmart('Xverse');
NexusWalletConnect.tryMobileAutoReconnect();
NexusWalletConnect.isMobileDevice();
// ... all the same functions, accessed as properties
```

> **Note:** The OordinalsSDK (sat `534764996708111`) does **not** re-export the mobile deep-link functions. If you only import the SDK, you get marketplace/inscription/UTXO functions but not `connectSmart`, `tryMobileAutoReconnect`, etc. Use Option A or B above for mobile support.

### Sat Number Reference

| Module | Sat | Import Path |
|--------|-----|-------------|
| `01-base-provider.js` | `534764996700154` | `/r/sat/534764996700154/at/-1/content` |
| `02-normalizers.js` | `534764996700484` | `/r/sat/534764996700484/at/-1/content` |
| `03-wallet-connector.js` | `534764996700814` | `/r/sat/534764996700814/at/-1/content` |
| `04-unisat-provider.js` | `534764996701144` | `/r/sat/534764996701144/at/-1/content` |
| `05-xverse-provider.js` | `534764996701474` | `/r/sat/534764996701474/at/-1/content` |
| `06-okx-provider.js` | `534764996701804` | `/r/sat/534764996701804/at/-1/content` |
| `07-leather-provider.js` | `534764996702134` | `/r/sat/534764996702134/at/-1/content` |
| `08-phantom-provider.js` | `534764996702464` | `/r/sat/534764996702464/at/-1/content` |
| `09-wizz-provider.js` | `534764996702794` | `/r/sat/534764996702794/at/-1/content` |
| `10-oyl-provider.js` | `534764996703124` | `/r/sat/534764996703124/at/-1/content` |
| `11-bitmapwallet-provider.js` | `534764996703454` | `/r/sat/534764996703454/at/-1/content` |
| **`12-wallet-connect.js`** | **`534764996703784`** | **`/r/sat/534764996703784/at/-1/content`** |
| `13-wallet-sign-wrapper.js` | `534764996704114` | `/r/sat/534764996704114/at/-1/content` |
| Nexus Loader | `534764996708771` | `/r/sat/534764996708771/at/-1/content` |
| OordinalsSDK | `534764996708111` | `/r/sat/534764996708111/at/-1/content` |

### 2. Auto-Reconnect on Load

```js
// App initialization
async function init() {
  // Try auto-reconnect from a mobile redirect
  const provider = await tryMobileAutoReconnect();
  if (provider) {
    updateUI(getState());
    return;
  }

  // Otherwise, show wallet picker
  showWalletPicker();
}
```

### 3. Build a Wallet Picker

```js
function showWalletPicker() {
  const deviceType = getDeviceType();
  const installed = detectWallets();      // Desktop: extension-based
  const mobileOptions = listMobileWalletOptions(); // Mobile: deep-link–based

  if (deviceType === 'desktop') {
    // Show installed extensions
    for (const wallet of installed) {
      renderButton(wallet.name, () => connectSmart(wallet.name));
    }
  } else {
    // Show mobile wallet options (Xverse, Phantom, UniSat)
    for (const option of mobileOptions) {
      renderButton(option.title, () => connectSmart(option.name));
    }

    // Also show any injected wallets (in case user is already in an in-app browser)
    for (const wallet of installed) {
      renderButton(`${wallet.name} (extension)`, () => connect(wallet.name));
    }
  }
}
```

### 4. Listen for State Changes

```js
const unsubscribe = subscribe((state) => {
  if (state.isConnected) {
    console.log('Wallet:', state.walletType);
    console.log('Address:', state.address);
    console.log('Ordinals:', state.ordinalsAddress);
    console.log('Payment:', state.paymentAddress);
    console.log('Balance:', state.balance, 'BTC');
  }
});
```

### 5. Full Minimal Example (HTML)

```html
<script type="module">
  import {
    connectSmart,
    tryMobileAutoReconnect,
    getState,
    subscribe,
    disconnect,
    detectWallets,
    listMobileWalletOptions,
    isMobileDevice
  } from '/r/sat/534764996703784/at/-1/content';

  // Auto-reconnect after mobile redirect
  const provider = await tryMobileAutoReconnect();
  if (provider) {
    document.getElementById('status').textContent =
      `Connected: ${getState().walletType} — ${getState().address}`;
  }

  // Populate wallet buttons
  const container = document.getElementById('wallets');
  const wallets = isMobileDevice()
    ? listMobileWalletOptions()
    : detectWallets();

  for (const w of wallets) {
    const btn = document.createElement('button');
    btn.textContent = w.name || w.title;
    btn.onclick = async () => {
      try {
        const result = await connectSmart(w.name);
        if (result.redirected) return; // page will reload in wallet browser
        document.getElementById('status').textContent =
          `Connected: ${getState().address}`;
      } catch (err) {
        alert(err.message);
      }
    };
    container.appendChild(btn);
  }

  // Disconnect button
  document.getElementById('disconnect').onclick = async () => {
    await disconnect();
    document.getElementById('status').textContent = 'Disconnected';
  };
</script>

<div id="wallets"></div>
<p id="status">Not connected</p>
<button id="disconnect">Disconnect</button>
```

---

## Configuring Custom Deep Links

### At Runtime (Recommended)

Set deep links before any connect calls. This works for wallets not covered by defaults (e.g. OKX, or a custom wallet):

```js
// Direct assignment
window.NEXUS_MOBILE_WALLET_DEEPLINKS = {
  OKX: (targetUrl) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(targetUrl)}`,
  MyWallet: 'mywallet://browse?url={url}'
};
```

Or programmatically:

```js
import { setMobileWalletDeepLinks } from '...wallet-connect...';

setMobileWalletDeepLinks({
  OKX: (targetUrl) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(targetUrl)}`,
  MyWallet: 'mywallet://browse?url={url}'
});
```

### Allowed Schemes

By default, only `https` and wallet-specific schemes (e.g. `unisat`) are allowed. To add custom URI schemes:

```js
window.NEXUS_MOBILE_WALLET_ALLOWED_SCHEMES = {
  MyWallet: ['mywallet', 'https'],
  '*': ['sharedscheme']      // Allowed for all wallets
};
```

---

## Building a Wallet Picker UI

### Probing All Wallets

Use `probeAllWallets()` to get a snapshot of every supported wallet's availability:

```js
import { probeAllWallets } from '...wallet-connect...';

const results = await probeAllWallets();
// [
//   { walletName: 'UniSat',  extension: true,  deepLink: 'unisat://...', deviceType: 'tablet', recommended: 'choose' },
//   { walletName: 'Xverse',  extension: false, deepLink: 'https://...', deviceType: 'tablet', recommended: 'app' },
//   { walletName: 'Phantom', extension: false, deepLink: null,           deviceType: 'tablet', recommended: 'install' },
//   ...
// ]
```

The `recommended` field tells you the best strategy:
- `'extension'` — use the browser extension
- `'app'` — redirect to the wallet app via deep link
- `'choose'` — both are available, let the user pick
- `'install'` — neither available, show download link

### Single Wallet Probe

```js
import { probeConnectionMethods } from '...wallet-connect...';

const probe = await probeConnectionMethods('Xverse', {
  extensionPollMs: 800,       // how long to wait for late-injecting extensions
  extensionPollAttempts: 6    // number of poll iterations
});
```

---

## Tablet & Hybrid Devices

Tablets are the trickiest case. They can run browser extensions (like desktop) AND native wallet apps (like phones). The wallet module detects these as `'tablet'` or `'hybrid'` device types.

### How `connectWithStrategy('auto')` Handles Tablets

1. Probes for both extension and deep link availability
2. If extension is detected → uses it
3. If extension connect fails but deep link exists → falls back to deep link
4. If only deep link → redirects to wallet app
5. If neither → throws with install instructions for both options

### Presenting Both Options

```js
const probe = await probeConnectionMethods('Xverse');

if (probe.recommended === 'choose') {
  // Show two buttons: "Use Extension" and "Open in Xverse App"
  showButton('Use Extension', () =>
    connectWithStrategy('Xverse', { strategy: 'extension' })
  );
  showButton('Open in Xverse App', () =>
    connectWithStrategy('Xverse', { strategy: 'app' })
  );
}
```

---

## Security Considerations

### Deep Link Validation

- All target URLs passed to deep link generators are validated as HTTP(S). Non-HTTP schemes (`javascript:`, `data:`, `vbscript:`) are rejected.
- Generated deep links are checked against per-wallet allowed-scheme lists before `window.location.href` assignment.
- The `_isValidHttpUrl()` check runs in `getMobileConnectUrl()` — you cannot bypass it by calling the function directly.

### Unsigned JWT Tokens (Xverse/sats-connect)

The `createUnsecuredToken()` helper creates Base64url-encoded JWTs with `alg: 'none'`. These are **not signed** and carry **no authentication guarantee**. They are only used for local wallet-provider communication via the sats-connect protocol. Never trust them on a server.

### Provider Injection Delay

On mobile, wallet providers can take up to several hundred milliseconds to inject after the webview loads. The module handles this via:
- `_waitForWalletInjection()` in UniSat (progressive backoff: 50ms, 100ms, 150ms… up to 8 attempts)
- Extension polling in `probeConnectionMethods()` (configurable `extensionPollMs` and `extensionPollAttempts`)
- `tryMobileAutoReconnect()` polls up to 10 times with 75ms× (i+1) backoff

### Session Storage

- `nexus.pendingMobileWallet` — stores the wallet name during a deep-link redirect. Cleared on first read. Only set for in-app-browser wallets (Xverse, Phantom).
- `nexus.unisat.mobileNonce` — stores a nonce for UniSat request/response correlation.

---

## Troubleshooting

### "Wallet not installed" on mobile

The wallet app isn't injecting its provider. This is expected in a normal mobile browser. Use `connectSmart()` instead of `connect()` — it will fall back to a deep link.

### Deep link opens but page doesn't connect

Call `tryMobileAutoReconnect()` on page load. The wallet provider may inject after a delay — the auto-reconnect helper polls for it.

### Tablet shows extension AND app options

This is correct behavior. Use `probeConnectionMethods()` to check what's available, and let the user choose or use `connectWithStrategy('auto')` to let the module decide.

### UniSat deep link doesn't work on iOS

UniSat's `unisat://` scheme requires the UniSat app to be installed and registered as a handler. On iOS, if the app isn't installed, the link will fail silently. Show a download fallback.

### OKX deep link not working

OKX deep links are not shipped by default because they vary across versions. Configure yours at runtime:

```js
window.NEXUS_MOBILE_WALLET_DEEPLINKS = {
  OKX: (url) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`
};
window.NEXUS_MOBILE_WALLET_ALLOWED_SCHEMES = {
  OKX: ['okx', 'https']
};
```

### Provider detected but connect() times out

Some wallets hang on `connect()` if the user doesn't approve the request in the app. The wallet module wraps operations with a 30-second timeout (60 seconds for signing). If the user doesn't respond in time, the promise rejects.

### Debug logging

Enable verbose wallet logs:

```js
window.NEXUS_WALLET_DEBUG = true;
```

All wallet modules check this flag and route `console.log/warn/error` through it. Logs are completely silent by default.
