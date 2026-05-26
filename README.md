# OnchainWalletConnect

Source modules for the inscription-ready wallet connection layer used by Nexus.

This package is built around a single on-chain wallet aggregator that:

- detects supported Bitcoin wallets
- connects through a normalized provider layer
- exposes a shared state object for wallet/session data
- handles mobile wallet deep links and in-app browser reconnects
- normalizes signing and provider quirks across wallets

No npm package is required when you consume the inscribed version. Import the on-chain module and use it directly.

---

## What To Import

### Direct wallet-connect import

```js
const NexusWalletConnect = (await import('/r/sat/534764996703784/at/-1/content')).default;
```

### From the Nexus loader

```js
const { NexusWalletConnect } = await import('/r/sat/534764996708771/at/-1/content');
```

If you are already using the Nexus loader, importing `NexusWalletConnect` from there is the simplest path.

---

## Supported Wallets

The current local source exports provider support for:

- `UniSat`
- `Xverse`
- `OKX`
- `Leather`
- `Phantom`
- `Wizz`
- `Oyl`
- `BitmapWallet`

You can inspect what is currently available on the page with:

```js
const installed = NexusWalletConnect.detectWallets();
console.log(installed);
```

Each detected entry includes wallet metadata such as `name`, `downloadUrl`, and supported feature labels.

---

## Quick Start

### Desktop or already inside a wallet browser

```js
const NexusWalletConnect = (await import('/r/sat/534764996703784/at/-1/content')).default;

await NexusWalletConnect.connect('UniSat');

const state = NexusWalletConnect.getState();
console.log(state.paymentAddress);
console.log(state.ordinalsAddress);
console.log(state.balance);
```

### Auto state subscription

```js
const unsubscribe = NexusWalletConnect.subscribe((state) => {
  console.log('wallet state changed', state);
});

// later
unsubscribe();
```

### Disconnect

```js
await NexusWalletConnect.disconnect();
```

---

## Mobile Wallet Flow

For mobile, the correct entry point is usually `connectSmart()` rather than `connect()`.

Use this sequence:

1. Run `tryMobileAutoReconnect()` during startup.
2. Call `connectSmart(walletName)` from a user gesture.
3. If it returns `{ redirected: true }`, the browser is handing off to the wallet app.
4. When the page reloads inside the wallet app browser, `tryMobileAutoReconnect()` finishes the connection.

```js
const NexusWalletConnect = (await import('/r/sat/534764996703784/at/-1/content')).default;

await NexusWalletConnect.tryMobileAutoReconnect();

async function connectWallet(walletName) {
  const result = await NexusWalletConnect.connectSmart(walletName);

  if (result?.redirected) {
    return;
  }

  console.log(NexusWalletConnect.getState());
}

await connectWallet('Xverse');
```

### Correct deep link behavior

- `Xverse` opens your dApp in its in-app browser with `https://connect.xverse.app/browser?url=<encoded-url>`
- `Phantom` opens your dApp in its in-app browser with `https://phantom.app/ul/browse/<encoded-url>?ref=<origin>`
- `UniSat` uses a `unisat://request?...` RPC bridge
- `OKX` does not ship with a built-in default deep link in this source; configure it yourself only after verifying the exact link on the target platform

### Strategy-based connection control

```js
const probe = await NexusWalletConnect.connectWithStrategy('Xverse', {
  strategy: 'probe'
});

console.log(probe);
// { walletName, extension, deepLink, deviceType, recommended, downloadUrl }

await NexusWalletConnect.connectWithStrategy('Xverse', {
  strategy: 'app'
});
```

### UniSat method deep links

```js
const signUrl = NexusWalletConnect.getUniSatMobileRequestUrl('signPsbt', [psbtHex, options]);
console.log(signUrl);
```

### Runtime deep link overrides

```js
window.NEXUS_MOBILE_WALLET_DEEPLINKS = {
  OKX: 'okx://wallet/dapp/url?dappUrl={url}'
};
```

### Mobile wallet option listing for UI

```js
const wallets = NexusWalletConnect.listMobileWalletOptions();
console.log(wallets);
```

This returns conservative mobile-open options for wallets that have a usable app-link flow.

---

## Common API Surface

### Connection and state

```js
await NexusWalletConnect.connect('Xverse');
await NexusWalletConnect.connectSmart('Xverse');
await NexusWalletConnect.disconnect();

const state = NexusWalletConnect.getState();
const provider = NexusWalletConnect.getCurrentProvider();
const wallets = NexusWalletConnect.detectWallets();
```

State shape:

```js
{
  isConnected: true,
  walletType: 'Xverse',
  address: '...',
  publicKey: '...',
  paymentAddress: '...',
  ordinalsAddress: '...',
  paymentPublicKey: '...',
  ordinalsPublicKey: '...',
  balance: 0.00123456,
  provider: {}
}
```

### Basic wallet actions

```js
await NexusWalletConnect.getBalance();
await NexusWalletConnect.getAddress();
await NexusWalletConnect.getAddresses();
await NexusWalletConnect.getPublicKey();
await NexusWalletConnect.getNetwork();
await NexusWalletConnect.switchNetwork('testnet');
```

### Signing and broadcasting

```js
await NexusWalletConnect.signMessage(address, 'hello');
await NexusWalletConnect.signPsbt(psbtHex, options);
await NexusWalletConnect.signPsbts([psbtHex1, psbtHex2], [opt1, opt2]);
await NexusWalletConnect.pushPsbt(psbtHex);
await NexusWalletConnect.pushTx(txHex);
```

### Transfers and asset helpers

```js
await NexusWalletConnect.sendBitcoin(toAddress, 1000);
await NexusWalletConnect.sendBTC(toAddress, 1000);
await NexusWalletConnect.sendInscription(...args);
await NexusWalletConnect.sendRunes(...args);
await NexusWalletConnect.transferRunes(...args);
await NexusWalletConnect.getUtxos();
await NexusWalletConnect.getInscriptions();
await NexusWalletConnect.getAllInscriptions();
```

The full module also forwards wallet-specific helper methods when the underlying provider supports them.

---

## Module Layout

This folder is split into small inscription-friendly modules.

### Core building blocks

- `01-base-provider.js` - shared provider base class
- `02-normalizers.js` - wallet output normalization helpers
- `03-wallet-connector.js` - generic request layer and provider discovery

### Wallet adapters

- `04-unisat-provider.js`
- `05-xverse-provider.js`
- `06-okx-provider.js`
- `07-leather-provider.js`
- `08-phantom-provider.js`
- `09-wizz-provider.js`
- `10-oyl-provider.js`
- `11-bitmapwallet-provider.js`

### Aggregator and shared signing

- `12-wallet-connect.js` - main public aggregator module
- `13-wallet-sign-wrapper.js` - batch/sequential PSBT signing fallback wrapper

`12-wallet-connect.js` is the primary public entry point. It imports the connector, normalizers, and wallet provider modules from their sat-based recursion URLs and exports a single default object plus named helpers.

---

## Notable Exports

The main module exposes these high-value helpers:

- `connect()`
- `connectSmart()`
- `connectWithStrategy()`
- `probeConnectionMethods()`
- `probeAllWallets()`
- `tryMobileAutoReconnect()`
- `getMobileConnectUrl()`
- `openMobileWallet()`
- `setMobileWalletDeepLinks()`
- `getUniSatMobileConnectUrl()`
- `getUniSatMobileRequestUrl()`
- `listMobileWalletOptions()`
- `loadNormalizers()`
- `loadWalletConnector()`
- `installParentWalletBridgeHost()`

If you need lower-level compatibility helpers, `03-wallet-connector.js` and `13-wallet-sign-wrapper.js` can also be consumed directly.

---

## Parent Frame Bridge

The wallet-connect module can install a parent wallet bridge host:

```js
NexusWalletConnect.installParentWalletBridgeHost();
```

That is used for environments where wallet access needs to be proxied through a parent frame instead of relying only on direct provider injection.

---

## Notes

- This README reflects the current local source in this workspace.
- The public GitHub repo may contain additional or renamed provider files depending on when it was exported.
- For integration examples that use the loader, see `sdk/INSCRIBED-README.md`.
- For the full mobile deep link behavior, see `../docs/integrations/MOBILE_DEEPLINK_INTEGRATION_GUIDE.md`.
