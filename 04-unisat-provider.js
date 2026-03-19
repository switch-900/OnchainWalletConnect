/**
 * UniSat Wallet Provider
 */

// Import from ordinal inscriptions (update sat numbers after inscribing)
import { BaseWalletProvider } from './01-base-provider.js'; 
import { normalizers } from './02-normalizers.js'; 

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugLog = (...args) => {
  if (__nexusWalletDebugEnabled()) console.log(...args);
};

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) console.warn(...args);
};

export class UniSatProvider extends BaseWalletProvider {
  constructor() {
    super('UniSat');
    
    // UniSat wallet detection
    // NOTE: in some mobile/in-app-browser contexts, injection can be slightly delayed.
    // Do not rely solely on a constructor snapshot; refresh dynamically.
    this.walletInstance = typeof window !== 'undefined' ? window.unisat : null;
    
    // Set feature flags
    this.features = {
      connect: true,
      getAddress: true,
      getPublicKey: true,
      getBalance: true,
      getNetwork: true,
      switchNetwork: true,
      signMessage: true,
      signPsbt: true,
      signPsbts: true,
      pushPsbt: true,
      pushTx: true,              // ✅ UniSat supports pushTx({rawtx: "hex"})
      sendBitcoin: true,
      sendInscription: false,
      getInscriptions: true,
      getAllInscriptions: true,
      inscribe: true,
      brc20: {
        transfer: true,
        deploy: false,
        mint: false,
        list: true              // ✅ NEW: getBRC20List support
      },
      runes: {
        send: true,
        mint: false,
        etch: false
      },
      atomicals: {
        transfer: false,
        mint: false
      },
      arc20: {
        transfer: false
      }
    };
  }

  isInstalled() {
    this._refreshWalletInstance();
    return !!this.walletInstance;
  }

  _refreshWalletInstance() {
    if (typeof window === 'undefined') return this.walletInstance;
    if (window.unisat) {
      this.walletInstance = window.unisat;
    }
    return this.walletInstance;
  }

  async _waitForWalletInjection({ maxAttempts = 8, baseDelayMs = 50 } = {}) {
    if (typeof window === 'undefined') return null;
    for (let i = 0; i < maxAttempts; i += 1) {
      this._refreshWalletInstance();
      if (this.walletInstance) return this.walletInstance;
      // small progressive backoff: 50ms, 100ms, 150ms...
      // keeps connect fast on desktop but helps mobile in-app injection.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)));
    }
    return null;
  }

  requireInstalled() {
    this._refreshWalletInstance();
    if (!this.walletInstance) {
      throw new Error(
        'UniSat wallet not installed or not detected.\n\n' +
          'Desktop: install the UniSat extension from https://unisat.io\n' +
          'Mobile: open this site inside UniSat\'s in-app browser so it can inject window.unisat.'
      );
    }
  }

  // ========================================
  // CONNECTION METHODS (using base class helpers)
  // ========================================

  async connect() {
    await this._waitForWalletInjection();
    this.requireInstalled();
    
    const accounts = await this.walletInstance.requestAccounts();
    if (accounts && accounts.length > 0) {
      this.address = accounts[0];
      this.isConnected = true;
      debugLog('✅ UniSat connected');
      return { address: this.address };
    }
    
    throw new Error('Failed to connect to UniSat wallet');
  }

  async getAddress() {
    this.requireInstalled();
    this.requireConnected();
    // UniSat doesn't have getAddress() - it stores address during connect
    // Return the stored address or get accounts[0]
    if (this.address) {
      return this.address;
    }
    // Fallback: get from accounts
    const accounts = await this.walletInstance.getAccounts();
    return accounts && accounts.length > 0 ? accounts[0] : null;
  }

  async getPublicKey() {
    this.requireConnected();
    return await this.walletInstance.getPublicKey();
  }

  async getBalance() {
    this.requireConnected();
    const balance = await this.walletInstance.getBalance();
    return normalizers.balance(balance, 'UniSat');
  }

  // ========================================
  // NETWORK METHODS
  // ========================================

  async getNetwork() {
    this.requireInstalled();
    const network = await this.walletInstance.getNetwork();
    return normalizers.network(network);
  }

  async switchNetwork(network) {
    this.requireInstalled();
    await this.walletInstance.switchNetwork(network);
    debugLog('✅ UniSat network switched');
  }

  async getChain() {
    this.requireInstalled();
    return await this.walletInstance.getChain();
  }

  async switchChain(chain) {
    this.requireInstalled();
    await this.walletInstance.switchChain(chain);
    debugLog('✅ UniSat chain switched');
  }

  // ========================================
  // SIGNING METHODS
  // ========================================

  async signMessage(message, type = 'ecdsa') {
    this.requireConnected();
    return await this.walletInstance.signMessage(message, type);
  }

  async multiSignMessage(messages, type = 'ecdsa') {
    this.requireConnected();
    return await this.walletInstance.multiSignMessage(messages, type);
  }

  async signData(data, type = 'ecdsa') {
    this.requireConnected();
    return await this.walletInstance.signData(data, type);
  }

  async signPsbt(psbtHex, options = {}) {
    this.requireConnected();
    
    if (!psbtHex || typeof psbtHex !== 'string') {
      throw new Error('Invalid PSBT: must be a non-empty string');
    }

    // UniSat expects PSBT hex strings, but some callers may provide base64.
    // Normalize to hex using the shared normalizer (Buffer-safe in browsers).
    const psbtArg = normalizers.psbtFormat(String(psbtHex).trim(), 'UniSat', 'input');

    debugLog('🔏 UniSat: Signing PSBT...');
    // IMPORTANT: UniSat supports passing signing options (toSignInputs, sighashType, autoFinalized).
    // Our higher-level flows rely on this to request SIGHASH_SINGLE|ANYONECANPAY (0x83).
    let signedPsbt;
    try {
      // Newer UniSat builds support (psbt, options)
      signedPsbt = await this.walletInstance.signPsbt(psbtArg, options);
    } catch (e) {
      const msg = String(e?.message || e || '');
      // If UniSat is explicitly telling us to whitelist sighashTypes, do NOT retry without options.
      // Retrying without options can cause UniSat to attempt signing unsupported inputs.
      if (/sighash\s*type\s*is\s*not\s*allowed/i.test(msg) || /sighashTypes/i.test(msg)) {
        throw new Error(msg);
      }

      // If UniSat can't find pubkey, it usually means the PSBT is missing required input UTXO metadata.
      // Retrying without options will not fix that and can make debugging harder.
      if (/without\s*utxo\s*data/i.test(msg) || /utxo\s*data/i.test(msg)) {
        throw new Error(
          `UniSat signPsbt failed: ${msg}. ` +
          'This usually means one or more PSBT inputs are missing witnessUtxo/nonWitnessUtxo (and for Taproot, tapInternalKey may be required).'
        );
      }

      const hasOptions = options && Object.keys(options).length > 0;
      if (hasOptions) {
        // Back-compat: some builds only accept (psbt) and will error on a second argument.
        if (/invalid\s*params/i.test(msg) || /argument/i.test(msg) || /parameters?/i.test(msg) || /not\s*support/i.test(msg) || /too\s*many/i.test(msg)) {
          debugWarn('⚠️ UniSat signPsbt(options) unsupported by this build, retrying without options');
          signedPsbt = await this.walletInstance.signPsbt(psbtArg);
        } else {
          // Do not silently drop options; surface the real error.
          throw new Error(msg);
        }
      } else {
        // No options: just try legacy signature.
        signedPsbt = await this.walletInstance.signPsbt(psbtArg);
      }
    }
    
    if (!signedPsbt) {
      throw new Error('No signed PSBT returned from UniSat');
    }

    debugLog('✅ UniSat PSBT signed successfully');
    return signedPsbt;
  }

  async signPsbts(psbtHexs, options = []) {
    this.requireConnected();
    if (!Array.isArray(psbtHexs)) {
      throw new Error('Invalid PSBTs: must be an array');
    }

    const normalizedPsbts = psbtHexs.map((psbt, idx) => {
      if (typeof psbt !== 'string' || psbt.length === 0) {
        throw new Error(`Invalid PSBT at index ${idx}: must be a non-empty string`);
      }

      // UniSat expects hex; tolerate base64 inputs for compatibility.
      try {
        return normalizers.psbtFormat(String(psbt).trim(), 'UniSat', 'input');
      } catch {
        throw new Error(`Invalid PSBT at index ${idx}: must be hex or base64`);
      }
    });

    return await this.walletInstance.signPsbts(normalizedPsbts, options);
  }

  async pushPsbt(psbtHex) {
    this.requireConnected();
    const txid = await this.walletInstance.pushPsbt(psbtHex);
    debugLog('✅ UniSat PSBT pushed');
    return txid;
  }

  async pushTx(rawtx) {
    this.requireConnected();
    // Robust handling: some UniSat versions expect raw hex string, others { rawtx }
    let txid;
    try {
      if (typeof rawtx === 'string') {
        // Try raw string first (most current UniSat builds)
        txid = await this.walletInstance.pushTx(rawtx);
      } else if (rawtx && typeof rawtx === 'object' && rawtx.rawtx) {
        txid = await this.walletInstance.pushTx(rawtx.rawtx);
      } else {
        // Fallback to object format
        txid = await this.walletInstance.pushTx({ rawtx: String(rawtx) });
      }
    } catch (e) {
      // Retry with alternate signature if first attempt failed
      if (typeof rawtx === 'string') {
        try {
          txid = await this.walletInstance.pushTx({ rawtx });
        } catch (e2) {
          throw new Error(`UniSat pushTx failed (string & object attempts): ${e2?.message || e2}`);
        }
      } else {
        throw e;
      }
    }
    if (!txid || typeof txid !== 'string') {
      throw new Error('UniSat pushTx did not return a txid');
    }
    debugLog('✅ UniSat raw TX pushed');
    return txid;
  }

  async verifyMessageOfBIP322Simple(address, message, signature) {
    this.requireInstalled();
    return await this.walletInstance.verifyMessageOfBIP322Simple(address, message, signature);
  }

  // ========================================
  // TRANSACTION METHODS
  // ========================================

  async sendBitcoin(toAddress, amount) {
    this.requireConnected();
    BaseWalletProvider.validateSendParams(toAddress, amount);
    const txid = await this.walletInstance.sendBitcoin(toAddress, amount);
    debugLog('✅ UniSat transaction sent');
    return txid;
  }

  async getBitcoinUtxos() {
    this.requireConnected();
    return await this.walletInstance.getBitcoinUtxos();
  }

  // ========================================
  // INSCRIPTION METHODS
  // ========================================

  async getInscriptions(cursor = 0, size = 100) {
    this.requireConnected();

    const result = await this.walletInstance.getInscriptions(cursor, size);
    
    // UniSat returns {total: number, list: Array}
    if (result && result.list) {
      debugLog(`📦 UniSat returned ${result.list.length} inscriptions`);
      
      // Normalize inscriptions using normalizers
      return {
        list: result.list.map(inscription => normalizers.inscription(inscription, 'UniSat')),
        total: result.total
      };
    }
    
    return { list: [], total: 0 };
  }

  // getAllInscriptions() inherited from BaseWalletProvider with automatic pagination

  async inscribe(content, options = {}) {
    this.requireConnected();

    const {
      contentType = 'text/plain;charset=utf-8',
      feeRate = 10,
      metadata
    } = options;

    // UniSat primarily supports BRC-20 inscriptions via inscribeTransfer
    if (contentType.includes('brc-20') || (metadata && metadata.brc20)) {
      const brc20Data = metadata.brc20 || JSON.parse(content);
      return await this.inscribeTransfer(brc20Data.tick, brc20Data.amt);
    }

    // Keep providers generic: do not orchestrate inscriptions here.
    // Signal to the app that wallet can sign PSBTs; the app should build commit+reveal externally.
    debugLog('📝 UniSat: PSBT signing supported (app builds commit+reveal)');
    return {
      method: 'psbt',
      requiresPsbtBuilding: true,
      walletSupportsSign: typeof this.walletInstance.signPsbt === 'function',
      message: 'Build commit+reveal PSBTs externally; wallet will sign/broadcast as requested.'
    };
  }

  async inscribeTransfer(ticker, amount) {
    this.requireConnected();
    const txid = await this.walletInstance.inscribeTransfer(ticker, amount);
    debugLog('✅ UniSat BRC-20 transfer inscribed');
    return txid;
  }

  /**
   * Get BRC-20 token balances
   * @returns {Promise<Array>} Array of BRC-20 token balances
   */
  async getBRC20List() {
    this.requireConnected();
    
    try {
      // UniSat may have getBRC20Summary or similar method
      if (this.walletInstance.getBRC20Summary) {
        return await this.walletInstance.getBRC20Summary();
      }
      
      // Fallback: return empty array if method doesn't exist
      debugWarn('⚠️ UniSat BRC-20 listing not available in this wallet version');
      return [];
    } catch (error) {
      debugWarn('❌ Failed to get BRC-20 list');
      throw error;
    }
  }

  // ========================================
  // RUNES METHODS
  // ========================================

  async sendRunes(toAddress, runeName, amount) {
    this.requireConnected();
    const txid = await this.walletInstance.sendRunes(toAddress, runeName, amount);
    debugLog('✅ UniSat runes sent');
    return txid;
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  async getAccounts() {
    this.requireInstalled();
    return await this.walletInstance.getAccounts();
  }

  async getVersion() {
    this.requireInstalled();
    return await this.walletInstance.getVersion();
  }

  async getBalanceV2() {
    this.requireConnected();
    return await this.walletInstance.getBalanceV2();
  }

  // ========================================
  // EVENT LISTENERS
  // ========================================

  setupEventListeners() {
    if (!this.isInstalled()) return;
    
    const wallet = this.walletInstance;
    if (!wallet || !wallet.on) return;
    
    // Account changes
    wallet.on('accountsChanged', (accounts) => {
      debugLog('👤 UniSat accounts changed');
      
      if (!accounts || accounts.length === 0) {
        this.address = null;
        this.publicKey = null;
        this.isConnected = false;
      } else {
        this.address = accounts[0];
        // Clear stale publicKey from the previous account.
        // The old key no longer corresponds to the new address.
        // Callers should re-fetch via getPublicKey() if needed.
        this.publicKey = null;
      }
    });
    
    // Network changes
    wallet.on('networkChanged', (network) => {
      debugLog('🌐 UniSat network changed');
    });
    
    debugLog('✅ UniSat event listeners set up');
  }

  removeEventListeners() {
    if (!this.isInstalled()) return;
    
    const wallet = this.walletInstance;
    if (wallet && wallet.removeAllListeners) {
      wallet.removeAllListeners('accountsChanged');
      wallet.removeAllListeners('networkChanged');
    }
  }
}

export default UniSatProvider;
