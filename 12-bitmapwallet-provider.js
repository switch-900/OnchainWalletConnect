/**
 * BitmapWalletProvider
 * Full feature support:
 * - Connection: connect(), disconnect(), getAccounts()
 * - Address: getAddress(), getPublicKey()
 * - Balance: getBalance(), getUtxos(), getSpendableUtxos()
 * - Network: getNetwork(), switchNetwork()
 * - Signing: signMessage(), signPsbt(), signPsbts()
 * - Broadcasting: pushPsbt(), pushTx()
 * - Inscriptions: getInscriptions(), detectBitmaps()
 * - Runes: getRunes(), getRareSats()
 * - Sending: sendBitcoin(), sendInscription()
 * - Fees: getFeeRate()
 * - Events: accountsChanged, networkChanged, disconnect
 * 
 * EIP-1193 compatible request({method, params}) interface
 */

import { BaseWalletProvider } from './01-base-provider.js';

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugLog = (...args) => {
  if (__nexusWalletDebugEnabled()) console.log(...args);
};

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) console.warn(...args);
};

export class BitmapWalletProvider extends BaseWalletProvider {
  constructor() {
    super('BitmapWallet');

    // a minimal in-memory event registry
    this._events = new Map();

    // note: this.walletInstance is expected to be the inpage provider when available
    this.walletInstance = (typeof window !== 'undefined' && window.bitmapWallet) ? window.bitmapWallet : null;
    this.isConnected = !!this.walletInstance?.isConnected;
    this.address = this.isConnected ? (this.walletInstance.getAddress ? this.walletInstance.getAddress() : null) : null;
  }

  // Override isInstalled to check for BitmapWallet specifically
  isInstalled() {
    return typeof window !== 'undefined' && 
           window.bitmapWallet && 
           typeof window.bitmapWallet.request === 'function';
  }

  // Setup event listeners for wallet events
  setupEventListeners() {
    if (!this.walletInstance) return;

    // Listen for account changes
    if (typeof this.walletInstance.on === 'function') {
      this.walletInstance.on('accountsChanged', (accounts) => {
        if (accounts && accounts.length > 0) {
          this.address = accounts[0];
          this._emit('accountsChanged', { accounts, address: this.address });
        }
      });

      this.walletInstance.on('networkChanged', (network) => {
        this._emit('networkChanged', { network });
      });

      this.walletInstance.on('disconnect', () => {
        this.isConnected = false;
        this.address = null;
        this._emit('disconnect');
      });
    }
  }

  // Low-level EIP-1193 style request method
  async request(methodOrArgs, maybeParams) {
    // support both request({method, params}) and request(method, params)
    let method;
    let params;
    if (typeof methodOrArgs === 'object' && methodOrArgs !== null) {
      method = methodOrArgs.method;
      params = methodOrArgs.params;
    } else {
      method = methodOrArgs;
      params = maybeParams;
    }

    switch (method) {
      case 'connect':
        return await this.connect(params?.options);
      case 'disconnect':
        return await this.disconnect();
      case 'requestAccounts':
      case 'getAccounts':
        return await this.getAccounts();
      case 'getAddress':
        return await this.getAddress();
      case 'getBalance':
        return await this.getBalance(params);
      case 'getInscriptions':
        return await this.getInscriptions(params || {});
      case 'signMessage':
        return await this.signMessage(params);
      case 'signPsbt':
        return await this.signPsbt(params?.psbt || params);
      case 'signPsbts':
        return await this.signPsbts(params?.psbts || params);
      case 'pushPsbt':
        return await this.pushPsbt(params?.psbt || params);
      case 'pushTx':
        return await this.pushTx(params?.hex || params);
      case 'getUtxos':
        return await this.getUtxos(params?.address || params);
      case 'getFeeRate':
        return await this.getFeeRate();
      case 'getNetwork':
        return await this.getNetwork();
      case 'switchNetwork':
        return await this.switchNetwork(params?.network || params);
      case 'getSpendableUtxos':
        return await this.getSpendableUtxos(params?.address || params);
      case 'getRunes':
        return await this.getRunes(params?.address || params);
      case 'getRareSats':
        return await this.getRareSats(params?.address || params);
      case 'sendBitcoin':
        return await this.sendBitcoin(params?.toAddress, params?.satoshis, params?.options);
      case 'sendInscription':
        return await this.sendInscription(params?.address, params?.inscriptionId, params?.options);
      case 'detectBitmaps':
        return await this.detectBitmaps();
      default:
        // If underlying inpage provider has request, forward
        if (this.walletInstance && typeof this.walletInstance.request === 'function') {
          return await this.walletInstance.request({ method, params });
        }
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  async connect(options = {}) {
    debugLog('🔌 BitmapWalletProvider.connect() called', { hasInstance: !!this.walletInstance });
    
    // Check if wallet is installed
    if (!this.walletInstance) {
      throw new Error('BitmapWallet not installed or not detected at window.bitmapWallet');
    }

    // Setup event listeners
    this.setupEventListeners();
    
    // If inpage provider exposes connect, use it
    if (typeof this.walletInstance.connect === 'function') {
      debugLog('🔌 Calling window.bitmapWallet.connect()...');
      const res = await this.walletInstance.connect(options);
      debugLog('✅ window.bitmapWallet.connect() returned');
      this.isConnected = true;
      
      // Try to get address
      try {
        this.address = await this.getAddress();
        debugLog('✅ Got address');
      } catch (e) {
        debugWarn('⚠️ Could not get address after connect');
      }
      
      // Return result with address field for dev-loader-simple
      return {
        ...res,
        address: this.address || res.address || res.accounts?.[0],
        connected: true
      };
    }

    // If inpage provider has requestAccounts (EIP-1193 pattern)
    if (typeof this.walletInstance.requestAccounts === 'function') {
      debugLog('🔌 Calling window.bitmapWallet.requestAccounts()...');
      const accounts = await this.walletInstance.requestAccounts();
      debugLog('✅ requestAccounts() returned');
      this.isConnected = true;
      this.address = Array.isArray(accounts) ? accounts[0] : accounts;
      return {
        address: this.address,
        accounts,
        connected: true
      };
    }

    // Fallback: assume already connected if wallet instance exists
    debugWarn('⚠️ BitmapWallet has no connect() or requestAccounts() - assuming already connected');
    this.isConnected = true;
    
    // Try to get address
    try {
      this.address = await this.getAddress();
      debugLog('✅ Got address');
    } catch (e) {
      debugWarn('⚠️ Could not get address');
      throw new Error('BitmapWallet: Could not retrieve address. Wallet may not be connected.');
    }
    
    this._emit('connect', { address: this.address });
    return { 
      address: this.address,
      connected: true 
    };
  }

  async disconnect() {
    if (this.walletInstance?.disconnect) {
      const res = await this.walletInstance.disconnect();
      this.isConnected = false;
      this.address = null;
      this._emit('disconnect');
      return res;
    }
    this.isConnected = false;
    this.address = null;
    this._emit('disconnect');
    return { disconnected: true };
  }

  async getAccounts() {
    if (this.walletInstance?.getAccounts) return await this.walletInstance.getAccounts();
    if (this.address) return [this.address];
    return [];
  }

  async getAddress() {
    if (this.walletInstance?.getAddress) return await this.walletInstance.getAddress();
    return this.address;
  }

  async getPublicKey() {
    if (this.walletInstance?.getPublicKey) return await this.walletInstance.getPublicKey();
    throw new Error('getPublicKey not available');
  }

  async getBalance() {
    if (this.walletInstance?.getBalance) return await this.walletInstance.getBalance();
    throw new Error('getBalance not available');
  }

  async getUtxos(address) {
    if (this.walletInstance?.getUtxos) return await this.walletInstance.getUtxos(address);
    throw new Error('getUtxos not available');
  }

  async getInscriptions({ offset = 0, limit = 100 } = {}) {
    if (this.walletInstance?.getInscriptions) return await this.walletInstance.getInscriptions({ offset, limit });
    return [];
  }

  async detectBitmaps() {
    if (this.walletInstance?.detectBitmaps) return await this.walletInstance.detectBitmaps();
    return [];
  }

  async signMessage({ address, message, protocol = 'BIP322' } = {}) {
    if (this.walletInstance?.signMessage) return await this.walletInstance.signMessage({ address, message, protocol });
    throw new Error('signMessage not available');
  }

  _isHexString(s) {
    return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
  }

  _looksLikePsbtBase64(s) {
    // PSBT magic header is "psbt\xff" which base64-encodes to a string starting with "cHNidP8".
    return typeof s === 'string' && s.startsWith('cHNidP8');
  }

  _isMagicNumberError(err) {
    const msg = String(err?.message || err || '');
    return /magic\s*number/i.test(msg);
  }

  async _getBitcoinJs() {
    if (typeof window !== 'undefined' && window.bitcoin?.Psbt) return window.bitcoin;
    // Also check window.BitcoinLib which is set by the inscription-based loader
    if (typeof window !== 'undefined' && window.BitcoinLib?.Psbt) return window.BitcoinLib;
    // Wait briefly for the inscription-based loader to finish (it loads async)
    if (typeof window !== 'undefined') {
      const waited = await new Promise(resolve => {
        let elapsed = 0;
        const iv = setInterval(() => {
          if (window.bitcoin?.Psbt || window.BitcoinLib?.Psbt) {
            clearInterval(iv);
            resolve(window.bitcoin || window.BitcoinLib);
          }
          elapsed += 100;
          if (elapsed > 3000) { clearInterval(iv); resolve(null); }
        }, 100);
      });
      if (waited) return waited;
    }
    throw new Error('bitcoinjs-lib not loaded. Ensure the page has loaded the bitcoin library from its inscription.');
  }

  async _convertPsbtString(psbtStr, toFormat /* 'hex' | 'base64' */) {
    const bitcoin = await this._getBitcoinJs();
    if (toFormat === 'base64') {
      if (this._looksLikePsbtBase64(psbtStr)) return psbtStr;
      if (this._isHexString(psbtStr)) {
        return bitcoin.Psbt.fromHex(psbtStr).toBase64();
      }
      // Best-effort: try base64 parse
      return bitcoin.Psbt.fromBase64(psbtStr).toBase64();
    }
    if (toFormat === 'hex') {
      if (this._isHexString(psbtStr)) return psbtStr;
      if (this._looksLikePsbtBase64(psbtStr)) {
        return bitcoin.Psbt.fromBase64(psbtStr).toHex();
      }
      // Best-effort: try hex parse
      return bitcoin.Psbt.fromHex(psbtStr).toHex();
    }
    return psbtStr;
  }

  async signPsbt(psbt, options = {}) {
    if (!psbt) throw new Error('psbt required');
    if (!this.walletInstance?.signPsbt) throw new Error('signPsbt not available');

    const original = psbt;
    const originalLooksHex = this._isHexString(original);
    const originalLooksB64 = this._looksLikePsbtBase64(original);
    const originalFormat = originalLooksHex ? 'hex' : (originalLooksB64 ? 'base64' : null);

    // Attempt 1: send as-is
    try {
      const res = await this.walletInstance.signPsbt(original, options);
      return res;
    } catch (err) {
      // If it's not a magic-number error, bubble it up.
      if (!this._isMagicNumberError(err)) throw err;

      // Attempt 2: flip encoding (hex <-> base64)
      const altFormat = originalLooksHex ? 'base64' : (originalLooksB64 ? 'hex' : 'base64');
      const altInput = await this._convertPsbtString(original, altFormat);
      const signedAlt = await this.walletInstance.signPsbt(altInput, options);

      // Return in original format when possible (our app commonly expects hex)
      if (typeof signedAlt === 'string' && originalFormat && originalFormat !== altFormat) {
        return await this._convertPsbtString(signedAlt, originalFormat);
      }
      return signedAlt;
    }
  }

  async signPsbts(psbts, options = {}) {
    if (!Array.isArray(psbts)) throw new Error('psbts must be an array');
    if (this.walletInstance?.signPsbts) {
      try {
        return await this.walletInstance.signPsbts(psbts, options);
      } catch (err) {
        // If the wallet rejects due to format, fall back to per-PSBT (with conversion)
        if (!this._isMagicNumberError(err)) throw err;
      }
    }
    // fallback: sign one-by-one (and let signPsbt handle format conversion)
    const results = [];
    for (let i = 0; i < psbts.length; i++) {
      results.push(await this.signPsbt(psbts[i], options));
    }
    return results;
  }

  async pushPsbt(psbt) {
    if (this.walletInstance?.pushPsbt) {
      // If PSBT is not a raw transaction (doesn't start with '02'), extract it
      let payload = psbt;
      if (typeof psbt === 'string' && !psbt.startsWith('02')) {
        try {
          // This is a PSBT hex/base64, need to extract the transaction
          const bitcoin = await this._getBitcoinJs();
          let psbtObj;
          if (this._isHexString(psbt)) {
            psbtObj = bitcoin.Psbt.fromHex(psbt);
          } else {
            psbtObj = bitcoin.Psbt.fromBase64(psbt);
          }
          payload = psbtObj.extractTransaction().toHex();
        } catch (e) {
          // If extraction fails, try to push as-is
          debugWarn('⚠️ Could not extract transaction from PSBT, pushing as-is');
        }
      }
      return await this.walletInstance.pushPsbt(payload);
    }
    throw new Error('pushPsbt not available');
  }

  async pushTx(hex) {
    if (this.walletInstance?.pushTx) return await this.walletInstance.pushTx(hex);
    throw new Error('pushTx not available');
  }

  async getFeeRate() {
    if (this.walletInstance?.getFeeRate) return await this.walletInstance.getFeeRate();
    throw new Error('getFeeRate not available');
  }

  async getNetwork() {
    if (this.walletInstance?.getNetwork) return await this.walletInstance.getNetwork();
    // Fallback: assume mainnet
    return 'mainnet';
  }

  async switchNetwork(network) {
    if (this.walletInstance?.switchNetwork) {
      const result = await this.walletInstance.switchNetwork(network);
      this._emit('networkChanged', { network });
      return result;
    }
    throw new Error('switchNetwork not available');
  }

  async getSpendableUtxos(address) {
    if (this.walletInstance?.getSpendableUtxos) return await this.walletInstance.getSpendableUtxos(address);
    // Fallback: use getUtxos (caller must filter)
    if (this.walletInstance?.getUtxos) return await this.walletInstance.getUtxos(address);
    throw new Error('getSpendableUtxos not available');
  }

  async getRunes(address) {
    if (this.walletInstance?.getRunes) return await this.walletInstance.getRunes(address);
    return [];
  }

  async getRareSats(address) {
    if (this.walletInstance?.getRareSats) return await this.walletInstance.getRareSats(address);
    return [];
  }

  async sendBitcoin(toAddress, satoshis, options = {}) {
    BaseWalletProvider.validateSendParams(toAddress, satoshis);
    if (this.walletInstance?.sendBitcoin) return await this.walletInstance.sendBitcoin(toAddress, satoshis, options);
    throw new Error('sendBitcoin not available');
  }

  async sendInscription(address, inscriptionId, options = {}) {
    if (this.walletInstance?.sendInscription) return await this.walletInstance.sendInscription(address, inscriptionId, options);
    throw new Error('sendInscription not available');
  }

  // Simple event emitter helpers
  on(event, handler) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event).add(handler);
    return () => this._events.get(event).delete(handler);
  }

  _emit(event, data) {
    const handlers = this._events.get(event);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(data); } catch (e) { debugWarn('bitmapwallet event handler error'); }
    }
  }
}

export default BitmapWalletProvider;
