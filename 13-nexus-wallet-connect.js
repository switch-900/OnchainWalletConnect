/**
 * NexusWalletConnect (On-chain)
 *
 * This is the inscription-ready wallet aggregator module.
 * It imports normalizers, wallet-connector helpers, and all provider modules
 * from their sat-based recursion URLs.
 */

// ============================================
// CRYPTO LIBRARIES
// ============================================
// This module assumes crypto deps are already loaded (e.g. by the hosting HTML).

// ============================================
// Import utility modules (on-chain)
// ============================================

import * as NormalizerModule from '/r/sat/1408319431385764/at/-1/content';
import * as WalletConnectorModule from '/r/sat/1180016128405661/at/-1/content';

// ============================================
// Import provider classes (on-chain)
// ============================================

import { UniSatProvider } from '/r/sat/1180016128407426/at/-1/content';
import { XverseProvider } from '/r/sat/1180016128407972/at/-1/content';
import { OKXProvider } from '/r/sat/1180016128408518/at/-1/content';
import { LeatherProvider } from '/r/sat/1180016128409064/at/-1/content';
import { PhantomProvider } from '/r/sat/1180016128409610/at/-1/content';
import { WizzProvider } from '/r/sat/1180016128410156/at/-1/content';
import { MagicEdenProvider } from '/r/sat/1180016128410702/at/-1/content';
import { OylProvider } from '/r/sat/1180016128411248/at/-1/content';
import { BitmapWalletProvider } from '/r/sat/404079598258113/at/-1/content';

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugLog = (...args) => {
  if (__nexusWalletDebugEnabled()) {
    globalThis.console.log(...args);
  }
};

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) {
    globalThis.console.warn(...args);
  }
};

const debugError = (...args) => {
  if (__nexusWalletDebugEnabled()) {
    globalThis.console.error(...args);
  }
};

// Shadow console in this module so logs are opt-in.
const console = {
  log: debugLog,
  info: debugLog,
  debug: debugLog,
  warn: debugWarn,
  error: debugError
};

/**
 * Wrap a promise with a timeout for wallet operations that may hang.
 * @param {Promise} promise
 * @param {number} [ms=30000]
 * @param {string} [label='Wallet operation']
 * @returns {Promise}
 */
function _withTimeout(promise, ms = 30000, label = 'Wallet operation') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

/**
 * Validate that a URL is a proper HTTP(S) URL.
 * Prevents javascript:, data:, or other dangerous URI schemes in deep links.
 * @param {string} url
 * @returns {boolean}
 */
function _isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Return the dust-limit threshold for a Bitcoin address based on its output type.
 * Values are from Bitcoin Core's GetDustThreshold() at minRelayTxFee = 1000 sat/kvB.
 *
 * P2PKH  (1...)            → 546 sats   (3 × 182 bytes)
 * P2SH   (3...)            → 540 sats   (3 × 180 bytes)
 * P2WPKH (bc1q, 42 chars)  → 294 sats   (3 × 98 vbytes)
 * P2WSH  (bc1q, 62 chars)  → 330 sats   (3 × 110 vbytes)
 * P2TR   (bc1p, 62 chars)  → 330 sats   (3 × 110 vbytes)
 *
 * @param {string} addr - Trimmed Bitcoin address
 * @returns {number} Dust limit in satoshis
 */
function _dustLimitForAddress(addr) {
  const lc = addr.toLowerCase();
  // Segwit v0 — P2WPKH (20-byte witness, ~42 chars) vs P2WSH (32-byte, ~62 chars)
  if (lc.startsWith('bc1q') || lc.startsWith('tb1q')) {
    return addr.length <= 44 ? 294 : 330;
  }
  // Taproot (P2TR)
  if (lc.startsWith('bc1p') || lc.startsWith('tb1p')) return 330;
  // Regtest
  if (lc.startsWith('bcrt1q')) return addr.length <= 46 ? 294 : 330;
  if (lc.startsWith('bcrt1p')) return 330;
  // P2SH (3... mainnet, 2... testnet)
  if (addr.startsWith('3') || addr.startsWith('2')) return 540;
  // P2PKH and fallback
  return 546;
}

// ============================================
// UTILITY EXPORTS (for advanced usage)
// ============================================

/**
 * Load normalizer helpers (inscriptions, balances, etc.)
 * @returns {Promise<Object>} Normalizer module exports
 */
export async function loadNormalizers() {
  return {
    normalizeInscription: NormalizerModule.normalizeInscription,
    normalizeBalance: NormalizerModule.normalizeBalance,
    normalizers: NormalizerModule.normalizers || NormalizerModule.default,
    normalizePsbtOptions: NormalizerModule.normalizePsbtOptions,
    normalizeNetwork: NormalizerModule.normalizeNetwork,
    normalizeAddress: NormalizerModule.normalizeAddress
  };
}

/**
 * Load the wallet connector utility module
 * @returns {Promise<Object>} Wallet connector exports
 */
export async function loadWalletConnector() {
  return WalletConnectorModule;
}

// ============================================
// WALLET METADATA
// ============================================

const WALLET_INFO = {
  UniSat: {
    name: 'UniSat',
    detection: () => typeof window !== 'undefined' && typeof window.unisat !== 'undefined',
    downloadUrl: 'https://unisat.io',
    features: ['BRC-20', 'Runes', 'Inscriptions']
  },
  Xverse: {
    name: 'Xverse',
    detection: () => typeof window !== 'undefined' && (
      typeof window.BitcoinProvider !== 'undefined' ||
      typeof window.XverseProviders !== 'undefined'
    ),
    downloadUrl: 'https://www.xverse.app',
    features: ['Ordinals', 'Payment', 'Inscriptions']
  },
  OKX: {
    name: 'OKX',
    detection: () => typeof window !== 'undefined' && typeof window.okxwallet?.bitcoin !== 'undefined',
    downloadUrl: 'https://www.okx.com/web3',
    features: ['BRC-20', 'Inscriptions']
  },
  Leather: {
    name: 'Leather',
    detection: () => {
      try {
        if (typeof window === 'undefined') return false;

        // Simple check - just look for the provider objects
        // Leather can be in btc_providers array OR window.LeatherProvider
        if (window.btc_providers && Array.isArray(window.btc_providers)) {
          const hasLeather = window.btc_providers.some(entry =>
            entry.id === 'LeatherProvider' ||
            entry.name === 'Leather' ||
            (entry.provider && entry.provider.isLeather)
          );
          if (hasLeather) {
            console.log('✅ Leather found in btc_providers array');
            return true;
          }
        }

        // Fallback: Check window directly
        const hasWindowLeather = !!(window.LeatherProvider || window.HiroWalletProvider);
        if (hasWindowLeather) {
          console.log('✅ Leather found in window object');
        }
        return hasWindowLeather;
      } catch (error) {
        console.warn('⚠️ Leather detection error:', error);
        return false;
      }
    },
    downloadUrl: 'https://leather.io',
    features: ['Stacks', 'Bitcoin']
  },
  Phantom: {
    name: 'Phantom',
    detection: () => typeof window !== 'undefined' && typeof window.phantom?.bitcoin !== 'undefined',
    downloadUrl: 'https://phantom.app',
    features: ['Limited Bitcoin Support']
  },
  Wizz: {
    name: 'Wizz',
    detection: () => typeof window !== 'undefined' && typeof window.wizz !== 'undefined',
    downloadUrl: 'https://wizzwallet.io',
    features: ['BRC-20', 'ARC-20', 'Atomicals', 'Runes']
  },
  MagicEden: {
    name: 'MagicEden',
    detection: () => typeof window !== 'undefined' && typeof window.magicEden?.bitcoin?.isMagicEden !== 'undefined',
    downloadUrl: 'https://wallet.magiceden.io',
    features: ['NFTs', 'Bitcoin']
  },
  Oyl: {
    name: 'Oyl',
    detection: () => typeof window !== 'undefined' && typeof window.oyl !== 'undefined',
    downloadUrl: 'https://oyl.io',
    features: ['Taproot', 'SegWit']
  },
  BitmapWallet: {
    name: 'BitmapWallet',
    detection: () => {
      if (typeof window === 'undefined') return false;
      const hasProvider = typeof window.bitmapWallet !== 'undefined' && typeof window.bitmapWallet.request === 'function';
      if (hasProvider) {
        console.log('✅ BitmapWallet found at window.bitmapWallet');
      }
      return hasProvider;
    },
    downloadUrl: 'https://bitmapwallet.io',
    features: ['Inscriptions', 'Bitmaps', 'UTXOs', 'Signing', 'Broadcasting', 'Rare Sats']
  }
};

// Provider class mapping
const PROVIDER_CLASSES = {
  UniSat: UniSatProvider,
  Xverse: XverseProvider,
  OKX: OKXProvider,
  Leather: LeatherProvider,
  Phantom: PhantomProvider,
  Wizz: WizzProvider,
  MagicEden: MagicEdenProvider,
  Oyl: OylProvider,
  BitmapWallet: BitmapWalletProvider
};

// ============================================
// STATE MANAGEMENT
// ============================================

let currentState = {
  isConnected: false,
  walletType: null,
  address: null,
  publicKey: null,
  paymentAddress: null,
  ordinalsAddress: null,
  paymentPublicKey: null,
  ordinalsPublicKey: null,
  balance: null,
  provider: null
};

const subscribers = new Set();

function setState(newState) {
  currentState = { ...currentState, ...newState };
  subscribers.forEach(callback => callback(currentState));
}

export function getState() {
  return { ...currentState };
}

export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function getCurrentProvider() {
  return currentState.provider;
}

export async function disconnect() {
  if (currentState.provider) {
    try {
      await currentState.provider.disconnect();
    } catch (error) {
      console.warn('Disconnect failed:', error);
    }
  }

  setState({
    isConnected: false,
    walletType: null,
    address: null,
    publicKey: null,
    paymentAddress: null,
    ordinalsAddress: null,
    paymentPublicKey: null,
    ordinalsPublicKey: null,
    balance: null,
    provider: null
  });
}

// ============================================
// Provider passthrough helpers
// ============================================

import { signPsbtsWithFallback } from './14-wallet-sign-wrapper.js';

export async function getBalance() {
  if (!currentState.provider) throw new Error('No wallet connected');

  const balanceData = await currentState.provider.getBalance();
  let balanceInBTC;

  // All providers should return satoshis (number) or a { confirmed, unconfirmed, total } object in sats.
  // Never guess whether a number is BTC vs sats — always treat as sats.
  if (typeof balanceData === 'number') {
    balanceInBTC = Math.round(balanceData) / 100000000;
  } else if (balanceData && typeof balanceData === 'object') {
    const totalSats = Number(balanceData.total) || Number(balanceData.confirmed) || 0;
    balanceInBTC = totalSats / 100000000;
  } else {
    balanceInBTC = 0;
  }

  setState({ balance: balanceInBTC });
  return balanceInBTC;
}

export async function getInscriptions(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  const result = await currentState.provider.getInscriptions(...args);
  if (result && typeof result === 'object' && Array.isArray(result.list)) return result.list;
  if (Array.isArray(result)) return result;
  return [];
}

export async function getAllInscriptions() {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.getAllInscriptions();
}

export async function signMessage(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.signMessage(...args);
}

export async function signPsbt(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await _withTimeout(
    currentState.provider.signPsbt(...args),
    60000,
    `${currentState.walletType || 'Wallet'} signPsbt`
  );
}

export async function signPsbts(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');

  // Preferred signature: signPsbts(psbts, options)
  // Some call sites pass (psbts, optionsArray) where optionsArray can be an array.
  const psbts = args?.[0];
  const options = args?.[1];
  if (Array.isArray(psbts)) {
    return await signPsbtsWithFallback(currentState.provider, psbts, options);
  }

  // Back-compat: if a caller forwards non-standard args, fall back to provider method.
  return await currentState.provider.signPsbts(...args);
}

export async function sendBitcoin(toAddress, satoshis, options = {}) {
  if (!currentState.provider) throw new Error('No wallet connected');
  // Validate at SDK level to prevent fund loss from bad parameters
  if (typeof toAddress !== 'string' || !toAddress.trim()) {
    throw new Error('Invalid recipient address: must be a non-empty string');
  }
  const _addr = toAddress.trim();
  const _lc = _addr.toLowerCase();
  const _validPrefix = (
    _lc.startsWith('bc1q') || _lc.startsWith('bc1p') ||
    _lc.startsWith('tb1q') || _lc.startsWith('tb1p') ||
    _lc.startsWith('bcrt1') ||
    /^[13mn2]/.test(_addr)
  );
  if (!_validPrefix || _addr.length < 26 || _addr.length > 90) {
    throw new Error('Invalid Bitcoin address format: unrecognized prefix or length');
  }
  if (!Number.isInteger(satoshis) || satoshis <= 0) {
    throw new Error('satoshis must be a positive integer');
  }
  // Dust limits per output type (Bitcoin Core defaults at minRelayTxFee = 1000 sat/kvB)
  const _dustLimit = _dustLimitForAddress(_addr);
  if (satoshis < _dustLimit) {
    throw new Error(`Amount ${satoshis} sats is below dust limit (${_dustLimit} sats for this address type)`);
  }
  return await _withTimeout(
    currentState.provider.sendBitcoin(toAddress, satoshis, options),
    60000,
    `${currentState.walletType || 'Wallet'} sendBitcoin`
  );
}

export async function sendBTC(...args) {
  return await sendBitcoin(...args);
}

export async function getNetwork() {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.getNetwork();
}

export async function switchNetwork(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.switchNetwork(...args);
}

export async function getPublicKey() {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.getPublicKey();
}

export async function getAddress() {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.getAddress();
}

export async function getAccounts() {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.getAccounts();
}

export async function pushPsbt(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.pushPsbt(...args);
}

export async function pushTx(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.pushTx(...args);
}

export async function sendInscription(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.sendInscription(...args);
}

export async function inscribe(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.inscribe(...args);
}

export async function sendRunes(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  return await currentState.provider.sendRunes(...args);
}

export function getWalletFeatures() {
  if (!currentState.provider) throw new Error('No wallet connected');
  return currentState.provider.getInfo();
}

export async function getAddresses(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.getAddresses !== 'function') {
    throw new Error(`${currentState.walletType} does not support getAddresses()`);
  }
  return await currentState.provider.getAddresses(...args);
}

export async function createRepeatInscriptions(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.createRepeatInscriptions !== 'function') {
    throw new Error(`${currentState.walletType} does not support batch inscriptions`);
  }
  return await currentState.provider.createRepeatInscriptions(...args);
}

export async function sendInscriptions(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.sendInscriptions !== 'function') {
    throw new Error(`${currentState.walletType} does not support sendInscriptions()`);
  }
  return await currentState.provider.sendInscriptions(...args);
}

export async function getRunesBalance() {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.getRunesBalance !== 'function') {
    throw new Error(`${currentState.walletType} does not support Runes`);
  }
  return await currentState.provider.getRunesBalance();
}

export async function transferRunes(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.transferRunes !== 'function') {
    throw new Error(`${currentState.walletType} does not support Runes transfer`);
  }
  return await currentState.provider.transferRunes(...args);
}

export async function mintRunes(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.mintRunes !== 'function') {
    throw new Error(`${currentState.walletType} does not support Runes minting`);
  }
  return await currentState.provider.mintRunes(...args);
}

export async function etchRunes(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.etchRunes !== 'function') {
    throw new Error(`${currentState.walletType} does not support Runes etching`);
  }
  return await currentState.provider.etchRunes(...args);
}

export async function getRunesOrder(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.getRunesOrder !== 'function') {
    throw new Error(`${currentState.walletType} does not support getRunesOrder()`);
  }
  return await currentState.provider.getRunesOrder(...args);
}

export async function signMultipleTransactions(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.signMultipleTransactions !== 'function') {
    throw new Error(`${currentState.walletType} does not support signMultipleTransactions()`);
  }
  return await currentState.provider.signMultipleTransactions(...args);
}

export async function createInscription(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.createInscription !== 'function') {
    throw new Error(`${currentState.walletType} does not support createInscription()`);
  }
  return await currentState.provider.createInscription(...args);
}

export async function getProductInfo() {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.getProductInfo !== 'function') {
    throw new Error(`${currentState.walletType} does not support getProductInfo() (Leather only)`);
  }
  return await currentState.provider.getProductInfo();
}

export async function getURL() {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.getURL !== 'function') {
    throw new Error(`${currentState.walletType} does not support getURL() (Leather only)`);
  }
  return await currentState.provider.getURL();
}

export async function signStructuredData(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.signStructuredData !== 'function') {
    throw new Error(`${currentState.walletType} does not support signStructuredData() (Leather only)`);
  }
  return await currentState.provider.signStructuredData(...args);
}

export async function authenticate(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.authenticate !== 'function') {
    throw new Error(`${currentState.walletType} does not support authenticate() (Leather only)`);
  }
  return await currentState.provider.authenticate(...args);
}

export async function sendStacksTransaction(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.sendStacksTransaction !== 'function') {
    throw new Error(`${currentState.walletType} does not support Stacks transactions (Leather only)`);
  }
  return await currentState.provider.sendStacksTransaction(...args);
}

export async function updateProfile(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.updateProfile !== 'function') {
    throw new Error(`${currentState.walletType} does not support updateProfile() (Leather only)`);
  }
  return await currentState.provider.updateProfile(...args);
}

export async function isHardware() {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.isHardware !== 'function') {
    throw new Error(`${currentState.walletType} does not support isHardware() (MagicEden only)`);
  }
  return await currentState.provider.isHardware();
}

export async function call(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.call !== 'function') {
    throw new Error(`${currentState.walletType} does not support call() (MagicEden only)`);
  }
  return await currentState.provider.call(...args);
}

export async function inscribeTransfer(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.inscribeTransfer !== 'function') {
    throw new Error(`${currentState.walletType} does not support inscribeTransfer()`);
  }
  return await currentState.provider.inscribeTransfer(...args);
}

export async function splitUtxo(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.splitUtxo !== 'function') {
    throw new Error(`${currentState.walletType} does not support splitUtxo() (OKX only)`);
  }
  return await currentState.provider.splitUtxo(...args);
}

export async function transferNft(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.transferNft !== 'function') {
    throw new Error(`${currentState.walletType} does not support transferNft() (OKX only)`);
  }
  return await currentState.provider.transferNft(...args);
}

export async function watchAsset(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.watchAsset !== 'function') {
    throw new Error(`${currentState.walletType} does not support watchAsset() (OKX only)`);
  }
  return await currentState.provider.watchAsset(...args);
}

export async function mint(...args) {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.mint !== 'function') {
    throw new Error(`${currentState.walletType} does not support mint() (OKX only)`);
  }
  return await currentState.provider.mint(...args);
}

export async function getCapabilities() {
  if (!currentState.provider) throw new Error('No wallet connected');
  if (typeof currentState.provider.getCapabilities !== 'function') {
    throw new Error(`${currentState.walletType} does not support getCapabilities()`);
  }
  return await currentState.provider.getCapabilities();
}

export async function getUtxos() {
  if (!currentState.provider) throw new Error('No wallet connected');

  const hasGetUtxos = typeof currentState.provider.getUtxos === 'function';
  const hasGetBitcoinUtxos = typeof currentState.provider.getBitcoinUtxos === 'function';
  const hasSplitUtxo = typeof currentState.provider.splitUtxo === 'function';

  if (!hasGetUtxos && !hasGetBitcoinUtxos && !hasSplitUtxo) {
    throw new Error(
      `${currentState.walletType} does not support UTXO fetching. Only UniSat and Wizz provide confirmed UTXO access. OKX has splitUtxo() method with different API.`
    );
  }

  let result;
  if (hasGetUtxos) {
    result = await currentState.provider.getUtxos();
  } else if (hasGetBitcoinUtxos) {
    result = await currentState.provider.getBitcoinUtxos();
  } else {
    console.log('🔍 Using OKX splitUtxo method for UTXO access...');
    const split = await currentState.provider.splitUtxo({ from: currentState.address, amount: 2 });
    result = split?.utxos || [];
  }

  console.log('✅ getUtxos result:', result);
  return result;
}

export async function getBRC20List() {
  if (!currentState.provider) throw new Error('No wallet connected');

  const hasList = typeof currentState.provider.getBRC20List === 'function';
  const hasSummary = typeof currentState.provider.getBRC20Summary === 'function';
  if (!hasList && !hasSummary) {
    throw new Error(`${currentState.walletType} does not support BRC-20 listing. Only UniSat provides BRC-20 token listing.`);
  }

  if (hasList) return await currentState.provider.getBRC20List();
  return await currentState.provider.getBRC20Summary();
}

// ============================================
// Wallet discovery & connection
// ============================================

export function createProvider(walletName) {
  const ProviderClass = PROVIDER_CLASSES[walletName];
  if (!ProviderClass) throw new Error(`Unknown wallet: ${walletName}`);

  const provider = new ProviderClass();

  if (!provider.isInstalled()) {
    const info = WALLET_INFO[walletName];
    throw new Error(`${walletName} wallet is not installed.\n\nDownload: ${info?.downloadUrl || 'Visit wallet website'}`);
  }

  return provider;
}

export function detectWallets() {
  const installed = [];
  for (const [name, info] of Object.entries(WALLET_INFO)) {
    if (info.detection && info.detection()) {
      installed.push({ name, ...info });
    }
  }

  console.log(`✅ Found ${installed.length} installed wallets:`, installed.map(w => w.name));
  return installed;
}

function _isMobileDevice() {
  if (typeof window === 'undefined') return false;

  // 1. userAgentData (Chromium 93+) — most reliable when available
  try {
    const uaData = navigator.userAgentData;
    if (uaData) {
      // If platform is Android, it's always a mobile/tablet device regardless of UA string.
      if ((uaData.platform || '').toLowerCase() === 'android') return true;
      if (typeof uaData.mobile === 'boolean') return uaData.mobile;
    }
  } catch {}

  const ua = (navigator.userAgent || '').toLowerCase();

  // 2. Standard mobile UA patterns
  if (/android|iphone|ipad|ipod|iemobile|opera mini|mobile/.test(ua)) return true;

  // 3. Samsung Internet browser — ALWAYS runs on a Samsung phone/tablet, even in desktop mode.
  //    Desktop-mode UA: "...SamsungBrowser/24.0 Chrome/120.0.6099.230 Safari/537.36"
  //    (no "android" or "mobile" token, but SamsungBrowser is Samsung-device-only)
  if (/samsungbrowser/i.test(ua)) return true;

  // 4. Silk browser (Amazon Fire devices)
  if (/\bsilk\b/.test(ua)) return true;

  return false;
}

export function isMobileDevice() {
  return _isMobileDevice();
}

/**
 * Detect tablet devices specifically.
 * Tablets are tricky: iPads with iPadOS 13+ report desktop Safari UA,
 * Samsung tablets may or may not include "mobile" in the UA string,
 * and Android tablets often just say "Android" without "Mobile".
 *
 * @returns {boolean}
 */
function _isTabletDevice() {
  if (typeof window === 'undefined') return false;

  const ua = (navigator.userAgent || '').toLowerCase();
  const rawUA = navigator.userAgent || '';

  // ── 1. userAgentData (Chromium 93+) — most reliable, check FIRST ──
  // Samsung Internet, Chrome on Android tablets: platform="Android", mobile=false
  // This catches Samsung tablets in desktop-mode UA where the UA string has NO "android" token.
  try {
    const uaData = navigator.userAgentData;
    if (uaData) {
      const platform = (uaData.platform || '').toLowerCase();
      if (platform === 'android' && uaData.mobile === false) return true;
    }
  } catch {}

  // ── 2. Samsung Internet browser on large-screen device ──
  // SamsungBrowser ONLY runs on Samsung devices. In desktop mode it hides "Android"
  // from the UA but keeps "SamsungBrowser". Combined with touch + screen size = tablet.
  if (/samsungbrowser/i.test(ua)) {
    // Samsung phones with SamsungBrowser: screen short-side < 600px typically.
    // Samsung tablets: short-side >= 600px.
    const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
    if (touchPoints > 1) {
      const minDim = Math.min(window.screen?.width || 0, window.screen?.height || 0);
      if (minDim >= 600) return true;
    }
  }

  // ── 3. iPadOS 13+ identifies as Mac — detect via touch ──
  if (/macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
    return true;
  }

  // ── 4. Explicit iPad in older UAs ──
  if (/ipad/.test(ua)) return true;

  // ── 5. Android tablet: "Android" in UA but no "Mobile" token ──
  if (/android/.test(ua) && !/mobile/.test(ua)) return true;

  // ── 6. Samsung-specific tablet model prefixes (SM-T, SM-X, SM-P) ──
  if (/sm-[txp]\d/i.test(rawUA)) return true;

  // ── 7. Amazon Fire tablets ──
  if (/kindle|silk/.test(ua) && !/mobile/.test(ua)) return true;

  // ── 8. Galaxy Tab identifiers ──
  if (/galaxy.*tab|gt-p\d|gt-n\d/i.test(rawUA)) return true;

  // ── 9. Touch + large screen heuristic (>= 768px shortest dimension) ──
  // This catches unrecognized tablets: any device with multi-touch and a large display
  // that isn't already identified as something else.
  if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
    const minDim = Math.min(window.screen?.width || 0, window.screen?.height || 0);
    if (minDim >= 768) return true;
  }

  return false;
}

export function isTabletDevice() {
  return _isTabletDevice();
}

/**
 * Hybrid device: tablet or large-screen mobile device that can run both
 * a full desktop browser AND native wallet apps.
 * These need the "probe both" strategy.
 *
 * @returns {boolean}
 */
function _isHybridDevice() {
  if (typeof window === 'undefined') return false;

  // Tablets are always hybrid
  if (_isTabletDevice()) return true;

  // Samsung DeX or desktop mode on phones/tablets: Android + large screen + pointer
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    // Check for Android in UA or userAgentData, or SamsungBrowser (always Samsung device)
    let isAndroidish = /android/.test(ua) || /samsungbrowser/i.test(ua);
    if (!isAndroidish) {
      try {
        isAndroidish = (navigator.userAgentData?.platform || '').toLowerCase() === 'android';
      } catch {}
    }
    if (isAndroidish) {
      const hasPointer = window.matchMedia?.('(pointer: fine)')?.matches;
      const largeScreen = Math.min(window.screen?.width || 0, window.screen?.height || 0) >= 600;
      if (hasPointer && largeScreen) return true;
    }
  } catch {}

  return false;
}

export function isHybridDevice() {
  return _isHybridDevice();
}

/**
 * Best-effort device classification.
 * @returns {'desktop'|'phone'|'tablet'|'hybrid'}
 */
export function getDeviceType() {
  if (typeof window === 'undefined') return 'desktop';
  if (_isTabletDevice()) return 'tablet';
  if (_isHybridDevice()) return 'hybrid';
  if (_isMobileDevice()) return 'phone';
  return 'desktop';
}

function _shouldTryMobileFallback(error) {
  const msg = (error && error.message ? String(error.message) : '').toLowerCase();
  return msg.includes('not installed') || msg.includes('not detected') || msg.includes('no provider');
}

export async function connect(walletName) {
  console.log(`🔌 Connecting to ${walletName}...`);
  const provider = createProvider(walletName);

  try {
    const result = await provider.connect();

    // Normalize multi-address wallets (Xverse, MagicEden, etc.) and single-address wallets
    // into a stable shape used throughout the app.
    const baseAddress = result.address || provider.address || null;
    const basePublicKey = result.publicKey || provider.publicKey || null;
    const paymentAddress = result.paymentAddress || provider.paymentAddress || baseAddress;
    const ordinalsAddress = result.ordinalsAddress || provider.ordinalsAddress || baseAddress;
    const paymentPublicKey = result.paymentPublicKey || provider.paymentPublicKey || basePublicKey;
    const ordinalsPublicKey = result.ordinalsPublicKey || provider.ordinalsPublicKey || basePublicKey;

    setState({
      isConnected: true,
      walletType: walletName,
      address: baseAddress,
      publicKey: basePublicKey,
      paymentAddress,
      ordinalsAddress,
      paymentPublicKey,
      ordinalsPublicKey,
      provider
    });

    console.log(`✅ Connected to ${walletName}`);

    try {
      const balanceData = await provider.getBalance();
      let balanceInBTC;
      let totalSats = 0;

      // All providers should return satoshis (number) or { confirmed, unconfirmed, total } in sats.
      // Never guess whether a number is BTC vs sats — always treat as sats.
      if (typeof balanceData === 'number') {
        totalSats = Math.round(balanceData);
        balanceInBTC = totalSats / 100000000;
      } else if (balanceData && typeof balanceData === 'object') {
        totalSats = Number(balanceData.total) || Number(balanceData.confirmed) || 0;
        balanceInBTC = totalSats / 100000000;
      } else {
        balanceInBTC = 0;
      }

      setState({ balance: balanceInBTC });
      console.log(`💰 Balance fetched: ${balanceInBTC} BTC (${totalSats} sats)`);
    } catch (balanceError) {
      console.warn('⚠️ Could not fetch balance:', balanceError.message);
      setState({ balance: null });
    }

    return provider;
  } catch (error) {
    console.error(`❌ Failed to connect to ${walletName}:`, error);
    throw error;
  }
}

/**
 * Mobile-aware connect helper.
 * - On desktop: behaves like connect().
 * - On mobile: first attempts connect() (for in-app browsers that inject providers).
 *   If provider injection is missing, falls back to openMobileWallet() when a deep link is configured.
 */
export async function connectSmart(walletName, options = {}) {
  const preferMobile = typeof options.preferMobile === 'boolean' ? options.preferMobile : null;
  const isMobile = preferMobile === null ? _isMobileDevice() : preferMobile;

  if (!isMobile) {
    return await connect(walletName);
  }

  try {
    return await connect(walletName);
  } catch (error) {
    if (_shouldTryMobileFallback(error)) {
      try {
        const deepLink = await openMobileWallet(walletName, options.targetUrl);
        return { redirected: true, deepLink };
      } catch {
        // If deep-linking is not configured or fails, fall through to original error.
      }
    }
    throw error;
  }
}

// ============================================
// TABLET / HYBRID DEVICE CONNECTION STRATEGY
// ============================================

/**
 * Probe which connection methods are available for a wallet on this device.
 *
 * This is the key function for tablets: it checks BOTH whether the browser
 * extension / in-page provider is injected AND whether a deep-link / app-link
 * is available, then returns a structured result so the UI can present options.
 *
 * @param {string} walletName - Wallet to probe
 * @param {Object} [options]
 * @param {number} [options.extensionPollMs=800] - How long to poll for late-injecting extensions
 * @param {number} [options.extensionPollAttempts=6] - How many poll iterations
 * @param {string} [options.targetUrl] - Deep link target URL override
 * @returns {Promise<Object>} { walletName, extension: bool, deepLink: string|null, deviceType, recommended }
 */
export async function probeConnectionMethods(walletName, options = {}) {
  const pollMs = options.extensionPollMs ?? 800;
  const maxAttempts = options.extensionPollAttempts ?? 6;
  const targetUrl = options.targetUrl || (typeof window !== 'undefined' ? window.location?.href : null);
  const deviceType = getDeviceType();

  // 1. Check if extension / in-page provider is already injected
  let extensionAvailable = false;
  const info = WALLET_INFO[walletName];

  if (info?.detection) {
    // Immediate check
    extensionAvailable = info.detection();

    // Some extensions inject late (especially in tablet browsers with extensions).
    // Poll with progressive backoff.
    if (!extensionAvailable && pollMs > 0) {
      const baseDelay = Math.max(50, Math.floor(pollMs / maxAttempts));
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, baseDelay * (i + 1)));
        if (info.detection()) {
          extensionAvailable = true;
          break;
        }
      }
    }
  }

  // 2. Check if a deep link / app link is available
  const deepLink = getMobileConnectUrl(walletName, targetUrl);
  const hasDeepLink = !!deepLink;

  // 3. Determine recommended strategy
  let recommended = 'extension'; // default
  if (extensionAvailable && hasDeepLink) {
    // Both available — let user choose (probe mode)
    recommended = 'choose';
  } else if (extensionAvailable) {
    recommended = 'extension';
  } else if (hasDeepLink) {
    recommended = 'app';
  } else {
    recommended = 'install'; // neither available
  }

  return {
    walletName,
    extension: extensionAvailable,
    deepLink: hasDeepLink ? deepLink : null,
    deviceType,
    recommended,
    downloadUrl: info?.downloadUrl || null
  };
}

/**
 * Connect to a wallet using an explicit strategy.
 *
 * Strategies:
 *   'auto'      — Default smart behavior (extension → deep link → error)
 *   'extension' — Force browser-extension / injected-provider path
 *   'app'       — Force deep-link / wallet-app path (redirect to in-app browser)
 *   'probe'     — Probe both methods and return a ProbeResult instead of connecting.
 *                 The caller (UI) can then present a choice (e.g. toggle/swipe) and
 *                 call connectWithStrategy() again with 'extension' or 'app'.
 *
 * @param {string} walletName
 * @param {Object} [options]
 * @param {'auto'|'extension'|'app'|'probe'} [options.strategy='auto']
 * @param {string} [options.targetUrl]
 * @param {number} [options.extensionPollMs] — poll time for extension detection
 * @param {number} [options.extensionPollAttempts] — poll attempts
 * @returns {Promise<Object>} Connected provider, redirect result, or probe result
 */
export async function connectWithStrategy(walletName, options = {}) {
  const strategy = options.strategy || 'auto';
  const deviceType = getDeviceType();

  // ── PROBE mode: just return what's available ──
  if (strategy === 'probe') {
    return await probeConnectionMethods(walletName, options);
  }

  // ── EXTENSION mode: force injected-provider path ──
  if (strategy === 'extension') {
    return await connect(walletName);
  }

  // ── APP mode: force deep-link path ──
  if (strategy === 'app') {
    const targetUrl = options.targetUrl || (typeof window !== 'undefined' ? window.location?.href : null);
    const deepLink = await openMobileWallet(walletName, targetUrl);
    return { redirected: true, deepLink, walletName };
  }

  // ── AUTO mode ──
  // On tablets/hybrid: probe first, try extension, fall back to app.
  // On phones: behave like connectSmart().
  // On desktop: just connect().
  if (deviceType === 'desktop') {
    return await connect(walletName);
  }

  if (deviceType === 'tablet' || deviceType === 'hybrid') {
    // Tablet strategy: probe first
    const probe = await probeConnectionMethods(walletName, options);

    if (probe.extension) {
      // Extension is available — use it
      try {
        return await connect(walletName);
      } catch (err) {
        // Extension detected but connect failed — try app if available
        if (probe.deepLink && _shouldTryMobileFallback(err)) {
          console.warn(`📱 Tablet: extension connect failed for ${walletName}, trying app deep-link...`);
          const deepLink = await openMobileWallet(walletName, options.targetUrl);
          return { redirected: true, deepLink, walletName, fallbackReason: 'extension-connect-failed' };
        }
        throw err;
      }
    }

    if (probe.deepLink) {
      // No extension, but deep link available
      const deepLink = await openMobileWallet(walletName, options.targetUrl);
      return { redirected: true, deepLink, walletName };
    }

    // Neither available
    const info = WALLET_INFO[walletName];
    throw new Error(
      `${walletName} wallet not found on this device.\n\n` +
      `On tablets, you can either:\n` +
      `  1. Install the ${walletName} browser extension, or\n` +
      `  2. Install the ${walletName} mobile app\n\n` +
      (info?.downloadUrl ? `Download: ${info.downloadUrl}` : '')
    );
  }

  // Phone: default to connectSmart behavior
  return await connectSmart(walletName, options);
}

/**
 * List available connection methods for all supported wallets on this device.
 * Useful for building a wallet-picker UI that shows the right options per device.
 *
 * @param {Object} [options]
 * @param {string[]} [options.wallets] - Wallet names to check (defaults to all known)
 * @param {string} [options.targetUrl] - Deep link target URL
 * @returns {Promise<Array>} Array of probe results per wallet
 */
export async function probeAllWallets(options = {}) {
  const wallets = options.wallets || Object.keys(WALLET_INFO);
  const results = await Promise.all(
    wallets.map(name => probeConnectionMethods(name, options).catch(err => ({
      walletName: name,
      extension: false,
      deepLink: null,
      deviceType: getDeviceType(),
      recommended: 'error',
      error: err?.message || String(err)
    })))
  );
  return results;
}

export function getWalletInfo(walletName) {
  return WALLET_INFO[walletName] || null;
}

export function getAllWalletInfo() {
  return { ...WALLET_INFO };
}

// ============================================
// MOBILE APP CONNECTION HELPERS
// ============================================

const MOBILE_DEEPLINKS_STORAGE_KEY = 'nexus.mobileWalletDeepLinks.v1';

// Optional runtime override for additional deep-link schemes:
// window.NEXUS_MOBILE_WALLET_ALLOWED_SCHEMES = {
//   WalletName: ['scheme1', 'scheme2'],
//   '*': ['sharedscheme']
// }
const DEFAULT_MOBILE_WALLET_ALLOWED_SCHEMES = Object.freeze({
  Phantom: ['https'],
  Xverse: ['https'],
  UniSat: ['unisat'],
  MagicEden: ['magiceden'],
  OKX: ['okx', 'https']
});

// Built-in defaults are intentionally minimal and only added when backed by official docs.
// Phantom docs (Jan 2026): https://docs.phantom.com/phantom-deeplinks/other-methods/browse
// UniSat docs: https://docs.unisat.io/developer-support/open-api-documentation/unisat-wallet/connect-with-unisat-mobile-wallet
// Xverse: opens in-app browser via universal link
// OKX: opens dApp in OKX mobile wallet browser
// MagicEden: universal link to open dApp in ME mobile wallet's in-app browser
const DEFAULT_MOBILE_DEEPLINKS = {
  Phantom: (targetUrl) => {
    const url = targetUrl || window.location?.href;
    const ref = window.location?.origin || window.location?.href || url;
    if (!url || !ref) return null;
    return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
  },
  // UniSat:
  // UniSat's web dApp integration depends on `window.unisat` injection.
  // Their documented `unisat://request?...` deep-link RPC is primarily designed for native apps.
  // UniSat: open the dApp URL inside UniSat's in-app browser via request bridge.
  UniSat: (targetUrl) => getUniSatMobileOpenUrlUrl(targetUrl, { fromScheme: 'unisat' }),
  Xverse: (targetUrl) => {
    // Xverse mobile: open the dApp URL inside Xverse's in-app browser
    const url = targetUrl || window.location?.href;
    if (!url) return null;
    return `https://connect.xverse.app/browser?url=${encodeURIComponent(url)}`;
  },
  // OKX:
  // OKX deep links and in-app browser behavior vary across versions and platforms.
  // We do not ship a default OKX mobile open-URL link here because it has been unreliable.
  // If you have a confirmed working OKX mobile link for your target platform(s), configure it at runtime via
  // setMobileWalletDeepLinks() / window.NEXUS_MOBILE_WALLET_DEEPLINKS.
  OKX: null,
  // Magic Eden:
  // Magic Eden does not publish a documented "open URL" deep link.
  MagicEden: null
};

// ============================================
// MOBILE WALLET LISTING (UI HELPERS)
// ============================================

// Wallets we can present as "open this URL" from a normal mobile browser.
export const DEFAULT_MOBILE_WALLET_NAMES = Object.freeze(['UniSat', 'Xverse', 'Phantom']);

async function _copyTextToClipboard(text) {
  const value = typeof text === 'string' ? text : String(text || '');
  if (!value) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to legacy copy method.
  }

  try {
    if (typeof document === 'undefined') return false;
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-9999px';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, el.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return !!ok;
  } catch {
    return false;
  }
}

export function getMagicEdenMobileOpenAppUrl(targetUrl) {
  if (typeof window === 'undefined') return null;
  const url = targetUrl || window.location?.href;
  // Per user-confirmed behavior (Feb 2026): these schemes open the Magic Eden app.
  // It may not auto-navigate to the dApp; we copy the URL and instruct users to paste.
  if (!url) return 'magiceden://';
  // Prefer the Browser route to match UX (paste URL in wallet browser).
  return `magiceden://browser?url=${encodeURIComponent(String(url))}`;
}

function _encodeBase64Utf8(text) {
  if (typeof text !== 'string') return '';
  if (typeof btoa === 'function') {
    // Handle UTF-8 safely
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    // chunk to avoid callstack limits
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  return '';
}

function _buildUniSatMobileRequestUrl({
  method,
  from,
  nonce,
  data
}) {
  if (typeof window === 'undefined') return null;
  const appName = encodeURIComponent(from || window.document?.title || 'NexusInscriber');
  const safeNonce = String(nonce || Math.random().toString(36).slice(2, 10));

  const base = `unisat://request?method=${encodeURIComponent(String(method || 'connect'))}`;
  const parts = [`from=${appName}`, `nonce=${encodeURIComponent(safeNonce)}`];
  if (typeof data === 'string' && data.length > 0) {
    parts.push(`data=${encodeURIComponent(data)}`);
  }

  try {
    window.sessionStorage?.setItem('nexus.unisat.mobileNonce', safeNonce);
  } catch {}

  return `${base}&${parts.join('&')}`;
}

export function getUniSatMobileConnectUrl({ from, nonce } = {}) {
  return _buildUniSatMobileRequestUrl({ method: 'connect', from, nonce });
}

// UniSat request/response deep link bridge.
// openDapp expects: data=base64(JSON.stringify([dappUrl])) and must be URL-encoded.
// NOTE: UniSat will try to callback to <from>://response?...; for web builds we default
// to from='unisat' so any callback stays inside the UniSat app.
export function getUniSatMobileOpenUrlUrl(targetUrl, { fromScheme, from, appId, nonce } = {}) {
  if (typeof window === 'undefined') return null;
  const url = targetUrl || window.location?.href;
  const scheme = String(fromScheme || from || 'unisat');
  if (!url) return getUniSatMobileConnectUrl({ from: scheme, nonce });
  const payload = JSON.stringify([String(url)]);
  const data = _encodeBase64Utf8(payload);
  const deepLink = _buildUniSatMobileRequestUrl({ method: 'openDapp', from: scheme, nonce, data });
  if (!deepLink || !appId) return deepLink;
  return `${deepLink}&appId=${encodeURIComponent(String(appId))}`;
}

export function getUniSatMobileRequestUrl(method, params = [], { from, nonce } = {}) {
  // UniSat docs specify: data=toBase64(JSON.stringify([ ... ]))
  // Example: signPsbt => [psbtHex, options]
  // Example: signMessage => [text, type]
  const payload = Array.isArray(params) ? params : [params];
  const data = _encodeBase64Utf8(JSON.stringify(payload));
  return _buildUniSatMobileRequestUrl({ method, from, nonce, data });
}

// Wallets that have an in-app browser (can open a dApp URL inside the wallet app).
// UniSat does NOT have an in-app browser — it uses a URI-scheme RPC bridge.
const WALLETS_WITH_INAPP_BROWSER = new Set(['Xverse', 'Phantom']);
const WALLETS_SIGNING_ONLY_APP = new Set(['UniSat']);  // app exists but no browser

function _isInAppBrowserMobileLink(walletName) {
  return WALLETS_WITH_INAPP_BROWSER.has(walletName);
}

function _isSigningOnlyApp(walletName) {
  return WALLETS_SIGNING_ONLY_APP.has(walletName);
}

/**
 * Returns a list of mobile wallet options suitable for rendering in UI.
 *
 * This is intentionally conservative: by default it only returns UniSat/Xverse/Phantom.
 *
 * @param {Object} [options]
 * @param {string} [options.targetUrl] - URL to open inside an in-app browser (Xverse/Phantom/...)
 * @param {string[]} [options.wallets] - Override wallet list
 */
export function listMobileWalletOptions(options = {}) {
  if (typeof window === 'undefined') return [];

  const targetUrl = options.targetUrl || window.location?.href;
  const wallets = Array.isArray(options.wallets) ? options.wallets : DEFAULT_MOBILE_WALLET_NAMES;
  const includeManual = !!options.includeManual;

  const out = [];

  if (includeManual) {
    out.push({
      name: 'MagicEden',
      title: 'Magic Eden',
      mode: 'manual',
      // Opens the Magic Eden app (does not reliably open the dApp URL inside the browser).
      appUrl: getMagicEdenMobileOpenAppUrl(targetUrl),
      downloadUrl: WALLET_INFO?.MagicEden?.downloadUrl || 'https://wallet.magiceden.io',
      notes:
        'Tapping "Open app" will copy this site\'s URL to your clipboard, then open Magic Eden. In Magic Eden, open the Browser tab and paste the URL.'
    });
  }

  for (const walletName of wallets) {
    const info = WALLET_INFO[walletName] || { name: walletName };

    const openUrl = getMobileConnectUrl(walletName, targetUrl);
    if (!openUrl) continue;

    const hasInAppBrowser = _isInAppBrowserMobileLink(walletName);
    const isSigningOnly = _isSigningOnlyApp(walletName);
    const mode = hasInAppBrowser ? 'inAppBrowser' : (isSigningOnly ? 'signingOnly' : 'unknown');

    const entry = {
      name: walletName,
      title: info.name || walletName,
      mode,
      hasInAppBrowser,
      openUrl,
      downloadUrl: info.downloadUrl || null
    };

    // Add helpful notes for wallets without in-app browsers
    if (isSigningOnly) {
      entry.notes = `${walletName} does not have an in-app browser. ` +
        `Use Xverse or Phantom to open this site directly, ` +
        `or install the ${walletName} browser extension on your tablet.`;
    }

    out.push(entry);
  }

  return out;
}

/**
 * Convenience: true if this wallet should be shown in a "mobile wallets" list.
 */
export function isMobileWalletOption(walletName) {
  return !!getMobileConnectUrl(walletName);
}

function _getUrlScheme(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol.replace(':', '').toLowerCase();
  } catch {
    return null;
  }
}

function _readMobileAllowedSchemes() {
  if (typeof window === 'undefined') return {};
  const runtime = window.NEXUS_MOBILE_WALLET_ALLOWED_SCHEMES;
  if (runtime && typeof runtime === 'object') return runtime;
  return {};
}

function _getAllowedDeepLinkSchemes(walletName) {
  const out = new Set(['https']);
  const add = (value) => {
    if (typeof value !== 'string') return;
    const v = value.trim().toLowerCase().replace(/:$/, '');
    if (v) out.add(v);
  };

  const walletDefaults = DEFAULT_MOBILE_WALLET_ALLOWED_SCHEMES?.[walletName];
  if (Array.isArray(walletDefaults)) {
    for (const s of walletDefaults) add(s);
  }

  const runtime = _readMobileAllowedSchemes();
  const wildcard = runtime?.['*'];
  const walletSpecific = runtime?.[walletName];

  if (Array.isArray(wildcard)) {
    for (const s of wildcard) add(s);
  } else {
    add(wildcard);
  }

  if (Array.isArray(walletSpecific)) {
    for (const s of walletSpecific) add(s);
  } else {
    add(walletSpecific);
  }

  // Backward-compatible fallback for custom walletName:// templates.
  if (typeof walletName === 'string' && walletName.trim()) {
    add(walletName.toLowerCase());
  }

  return out;
}

function _isSafeWalletDeepLink(walletName, deepLink) {
  const scheme = _getUrlScheme(deepLink);
  if (!scheme) return false;
  if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') return false;
  return _getAllowedDeepLinkSchemes(walletName).has(scheme);
}

function _readMobileDeepLinks() {
  if (typeof window === 'undefined') return {};

  const runtime = window.NEXUS_MOBILE_WALLET_DEEPLINKS;
  if (runtime && typeof runtime === 'object') return runtime;

  try {
    const raw = window.localStorage?.getItem(MOBILE_DEEPLINKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function _writeMobileDeepLinks(links) {
  if (typeof window === 'undefined') return;
  const safe = links && typeof links === 'object' ? links : {};
  window.NEXUS_MOBILE_WALLET_DEEPLINKS = safe;
  try {
    window.localStorage?.setItem(MOBILE_DEEPLINKS_STORAGE_KEY, JSON.stringify(safe));
  } catch {}
}

export function setMobileWalletDeepLinks(links) {
  _writeMobileDeepLinks(links);
  return _readMobileDeepLinks();
}

function _resolveDeepLinkTemplate(walletName) {
  const links = _readMobileDeepLinks();
  const direct = links?.[walletName];
  if (!direct) return null;
  if (typeof direct === 'function') return direct;
  if (typeof direct === 'string') return direct;
  return null;
}

function _resolveDeepLinkTemplateWithDefaults(walletName) {
  const direct = _resolveDeepLinkTemplate(walletName);
  if (direct) return direct;
  return DEFAULT_MOBILE_DEEPLINKS?.[walletName] || null;
}

export function getMobileConnectUrl(walletName, targetUrl) {
  if (typeof window === 'undefined') return null;

  const url = targetUrl || window.location?.href;
  if (!url) return null;

  // Validate URL is HTTP(S) — prevent javascript:, data:, or other dangerous URI schemes
  if (!_isValidHttpUrl(url)) {
    debugWarn(`getMobileConnectUrl rejected non-HTTP target URL: ${String(url).slice(0, 50)}`);
    return null;
  }

  const template = _resolveDeepLinkTemplateWithDefaults(walletName);
  if (!template) return null;

  const encodedUrl = encodeURIComponent(url);
  if (typeof template === 'function') {
    try {
      const resolved = template(url);
      if (!_isSafeWalletDeepLink(walletName, resolved)) {
        debugWarn(`Rejected deep link for ${walletName}: disallowed scheme`);
        return null;
      }
      return resolved;
    } catch {
      return null;
    }
  }
  const resolved = template.replace(/\{url\}/g, encodedUrl);
  if (!_isSafeWalletDeepLink(walletName, resolved)) {
    debugWarn(`Rejected deep link for ${walletName}: disallowed scheme`);
    return null;
  }
  return resolved;
}

export async function openMobileWallet(walletName, targetUrl) {
  if (typeof window === 'undefined') {
    throw new Error('openMobileWallet requires a browser environment');
  }

  if (walletName === 'MagicEden') {
    const url = targetUrl || window.location?.href;
    if (url && !_isValidHttpUrl(url)) {
      throw new Error('openMobileWallet: target URL must be HTTP or HTTPS');
    }
    await _copyTextToClipboard(url);
    const deepLink = getMagicEdenMobileOpenAppUrl(url);
    if (!deepLink) {
      throw new Error(
        'Could not build a Magic Eden deep link.\n\n' +
        'Open Magic Eden and use the Browser tab to open this site.'
      );
    }
    if (!_isSafeWalletDeepLink('MagicEden', deepLink)) {
      throw new Error('Magic Eden deep link is not allowed by current security policy');
    }
    window.location.href = deepLink;
    return deepLink;
  }

  const deepLink = getMobileConnectUrl(walletName, targetUrl);
  if (!deepLink) {
    throw new Error(
      `No mobile deep link configured for ${walletName}.\n\n` +
      `Configure window.NEXUS_MOBILE_WALLET_DEEPLINKS['${walletName}'] = '<template>' where <template> includes {url} placeholder.\n` +
      `Example: { '${walletName}': 'your-scheme://browse?url={url}' }`
    );
  }
  // Save the intended wallet so we can auto-reconnect after redirect.
  // When the page reloads inside the wallet's in-app browser, the provider
  // will be injected and tryMobileAutoReconnect() can pick up from here.
  try {
    // Only set for in-app-browser flows where the wallet will open our URL.
    if (_isInAppBrowserMobileLink(walletName)) {
      window.sessionStorage?.setItem('nexus.pendingMobileWallet', walletName);
    }
  } catch {}
  if (!_isSafeWalletDeepLink(walletName, deepLink)) {
    throw new Error(`${walletName} deep link is not allowed by current security policy`);
  }
  window.location.href = deepLink;
  return deepLink;
}

/**
 * Attempt to auto-reconnect after a mobile deep-link redirect.
 *
 * Call this early on page load (e.g. in your app's init or useEffect).
 * If the page was previously redirected via openMobileWallet(), this will:
 *   1. Detect which wallet was intended
 *   2. Check if the wallet provider is now injected (we're in the in-app browser)
 *   3. Automatically call connect() so signing & other operations work immediately
 *
 * @returns {Promise<Object|null>} The connected provider, or null if no pending reconnect.
 */
export async function tryMobileAutoReconnect() {
  if (typeof window === 'undefined') return null;
  const pending = window.sessionStorage?.getItem('nexus.pendingMobileWallet');
  if (!pending) return null;

  // Clear immediately so we don't loop on errors
  try { window.sessionStorage?.removeItem('nexus.pendingMobileWallet'); } catch {}

  console.log(`📱 Mobile auto-reconnect: attempting ${pending}...`);

  try {
    // Check if the wallet's provider is now injected
    const info = WALLET_INFO[pending];
    if (!info || !info.detection) {
      console.warn(`📱 ${pending} is not a known wallet type`);
      return null;
    }

    // Some mobile in-app browsers inject asynchronously; poll briefly.
    let detected = false;
    for (let i = 0; i < 10; i += 1) {
      if (info.detection()) {
        detected = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 75 * (i + 1)));
    }

    if (!detected) {
      console.warn(`📱 ${pending} provider not detected after redirect — user may need to connect manually`);
      return null;
    }

    // Provider is available — connect
    const provider = await connect(pending);
    console.log(`📱 ✅ Auto-reconnected to ${pending} after mobile redirect`);
    return provider;
  } catch (err) {
    console.warn(`📱 Auto-reconnect to ${pending} failed:`, err?.message);
    return null;
  }
}

export default {
  createProvider,
  detectWallets,
  connect,
  connectSmart,
  connectWithStrategy,
  disconnect,
  getState,
  subscribe,
  getCurrentProvider,
  getWalletInfo,
  getAllWalletInfo,

  // Mobile / tablet helpers
  setMobileWalletDeepLinks,
  getMobileConnectUrl,
  openMobileWallet,
  isMobileDevice,
  isTabletDevice,
  isHybridDevice,
  getDeviceType,
  tryMobileAutoReconnect,
  probeConnectionMethods,
  probeAllWallets,

  // Mobile wallet listing helpers
  DEFAULT_MOBILE_WALLET_NAMES,
  listMobileWalletOptions,
  isMobileWalletOption,
  getUniSatMobileConnectUrl,
  getUniSatMobileRequestUrl,
  
  loadNormalizers,
  loadWalletConnector,
  getBalance,
  getInscriptions,
  getAllInscriptions,
  signMessage,
  signPsbt,
  signPsbts,
  sendBitcoin,
  sendBTC,
  getNetwork,
  switchNetwork,
  getPublicKey,
  getAddress,
  getAccounts,
  pushPsbt,
  pushTx,
  sendInscription,
  inscribe,
  sendRunes,
  getWalletFeatures,
  getAddresses,
  createRepeatInscriptions,
  sendInscriptions,
  getRunesBalance,
  transferRunes,
  mintRunes,
  etchRunes,
  getRunesOrder,
  signMultipleTransactions,
  createInscription,
  getProductInfo,
  getURL,
  signStructuredData,
  authenticate,
  sendStacksTransaction,
  updateProfile,
  isHardware,
  call,
  inscribeTransfer,
  splitUtxo,
  transferNft,
  watchAsset,
  mint,
  getCapabilities,
  getUtxos,
  getBRC20List,
  WALLET_INFO
};
