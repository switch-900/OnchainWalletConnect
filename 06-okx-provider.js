/**
 * OKX Wallet Provider
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


export class OKXProvider extends BaseWalletProvider {
  constructor() {
    super('OKX');
    
    this.walletInstance = typeof window !== 'undefined' ? window.okxwallet?.bitcoin : null;
    
    this.features = {
      connect: true,
      getAddress: false, // OKX doesn't have getAddress() - use getAccounts() instead
      getPublicKey: true,
      getBalance: true,
      getNetwork: true,
      switchNetwork: false,
      signMessage: true,
      signPsbt: true,
      signPsbts: true, // Available in v2.77.1+
      pushPsbt: false, // ⚠️ UNRELIABLE: Returns success but doesn't broadcast (use Bitcoin Proxy instead)
      pushTx: false, // ⚠️ UNRELIABLE: Returns success but doesn't broadcast (use Bitcoin Proxy instead)
      sendBitcoin: true,
      sendInscription: true,
      getInscriptions: true,
      getAllInscriptions: true,
      inscribe: true,
      brc20: { transfer: true, deploy: true, mint: true }, // All available via mint()
      runes: { send: false, mint: false, etch: false },
      atomicals: { transfer: false, mint: false },
      arc20: { transfer: false }
    };
  }

  isInstalled() {
    return !!this.walletInstance;
  }

  async connect() {
    this.requireInstalled();
    
    const result = await this.walletInstance.connect();
    this.address = result.address || result;
    this.publicKey = result.publicKey;
    this.isConnected = true;
    
    debugLog('✅ OKX connected');
    return result;
  }

  async getAddress() {
    this.requireConnected();
    // OKX doesn't have a getAddress() method - use getAccounts() instead
    const accounts = await this.walletInstance.getAccounts();
    return accounts && accounts.length > 0 ? accounts[0] : this.address;
  }

  async getPublicKey() {
    this.requireConnected();
    return await this.walletInstance.getPublicKey();
  }

  async getBalance() {
    this.requireConnected();
    const balance = await this.walletInstance.getBalance();
    return normalizers.balance(balance, 'OKX');
  }

  async getNetwork() {
    this.requireInstalled();
    const network = await this.walletInstance.getNetwork();
    return normalizers.network(network);
  }

  async signMessage(message, type = 'ecdsa') {
    this.requireConnected();
    return await this.walletInstance.signMessage(message, type);
  }

  async signPsbt(psbtInput, options = {}) {
    this.requireConnected();
    
    // OKX signPsbt default autoFinalized is true in v2.77.1+
    debugLog('🔏 OKX: Signing PSBT...');

    // OKX expects PSBT hex; tolerate base64 inputs for compatibility.
    const psbtHex = normalizers.psbtFormat(String(psbtInput).trim(), 'OKX', 'input');

    const normalizedOptions = { ...(options || {}) };
    // Provide safe aliases across wallet SDK versions.
    if (normalizedOptions.autoFinalized === false) {
      normalizedOptions.autoFinalize = false;
    }

    const signedPsbt = await this.walletInstance.signPsbt(psbtHex, normalizedOptions);
    debugLog('✅ OKX PSBT signed');
    return signedPsbt;
  }

  async signPsbts(psbtInputs, options = []) {
    this.requireConnected();
    
    debugLog('🔏 OKX: Signing multiple PSBTs...');

    if (!Array.isArray(psbtInputs)) {
      throw new Error('Invalid PSBTs: must be an array');
    }

    const psbtHexs = psbtInputs.map((psbt, idx) => {
      if (typeof psbt !== 'string' || psbt.length === 0) {
        throw new Error(`Invalid PSBT at index ${idx}: must be a non-empty string`);
      }
      try {
        return normalizers.psbtFormat(String(psbt).trim(), 'OKX', 'input');
      } catch {
        throw new Error(`Invalid PSBT at index ${idx}: must be hex or base64`);
      }
    });

    const signedPsbts = await this.walletInstance.signPsbts(psbtHexs, options);
    debugLog('✅ OKX PSBTs signed');
    return signedPsbts;
  }

  // ⚠️ OKX's pushPsbt() and pushTx() are DISABLED because they return success but DO NOT broadcast!
  // Override the base class methods to throw errors and force fallback to OrdNexus extension or Bitcoin Proxy.
  // See features.pushPsbt = false and features.pushTx = false in constructor.
  
  async pushPsbt(psbtHex) {
    // Don't call the wallet - it will lie about broadcasting
    throw new Error('OKX broadcast not supported - use OrdNexus extension or Bitcoin Proxy');
  }

  async pushTx(rawTx) {
    // Don't call the wallet - it will lie about broadcasting
    throw new Error('OKX broadcast not supported - use OrdNexus extension or Bitcoin Proxy');
  }

  async sendBitcoin(toAddress, satoshis) {
    this.requireConnected();
    BaseWalletProvider.validateSendParams(toAddress, satoshis);
    
    const txid = await this.walletInstance.sendBitcoin(toAddress, satoshis);
    debugLog('✅ OKX transaction sent');
    return txid;
  }

  async sendInscription(toAddress, inscriptionId, options = {}) {
    this.requireConnected();
    const txid = await this.walletInstance.sendInscription(toAddress, inscriptionId, options);
    debugLog('✅ OKX inscription sent');
    return txid;
  }

  async getInscriptions(cursor = 0, size = 100) {
    this.requireConnected();
    
    const result = await this.walletInstance.getInscriptions(cursor, size);
    
    if (result && result.list) {
      return {
        list: result.list.map(i => normalizers.inscription(i, 'OKX')),
        total: result.total
      };
    }
    
    return { list: [], total: 0 };
  }

  async inscribe(content, options = {}) {
    this.requireConnected();

    // OKX has two different inscription methods:
    // 1. inscribe({ type, from, tick }) - Only for BRC-20 transfers
    // 2. mint({ type, from, inscriptions }) - For general inscriptions
    
    // If content is a simple string and looks like a BRC-20 ticker, use inscribe()
    if (typeof content === 'string' && content.length <= 5 && !options.contentType && !options.receiveAddress) {
      debugLog('🎫 OKX: Creating BRC-20 transfer inscription');
      // OKX inscribe() expects an OBJECT with type, from, and tick
      return await this.walletInstance.inscribe({
        type: 51, // Type 51 for BRC-20 transfer
        from: this.address,
        tick: content
      });
    }
    
    // Otherwise, use mint() for general inscriptions
    // OKX mint() expects: { type, from, inscriptions: [{ contentType, body }] }
    debugLog('🎨 OKX: Creating general inscription via mint()');
    
    const inscription = {
      contentType: options.contentType || 'text/plain;charset=utf-8',
      body: content // OKX uses 'body' not 'content'
    };
    
    const mintPayload = {
      type: 61, // Type 61 for plain text (60=deploy, 50=mint, 51=transfer, 62=image)
      from: this.address, // Required parameter
      inscriptions: [inscription] // Array of inscriptions (supports batch)
    };
    
    debugLog('🔍 OKX mint payload prepared');
    return await this.walletInstance.mint(mintPayload);
  }

  async inscribeTransfer(ticker, amount) {
    this.requireConnected();
    // OKX inscribe() method for BRC-20 transfers
    // Expects: { type: 51, from: address, tick: ticker }
    const result = await this.walletInstance.inscribe({
      type: 51, // Type 51 for BRC-20 transfer
      from: this.address,
      tick: ticker
    });
    debugLog('✅ OKX BRC-20 transfer inscribed');
    return result;
  }

  async getAccounts() {
    this.requireInstalled();
    return await this.walletInstance.getAccounts();
  }

  async splitUtxo(options) {
    this.requireConnected();
    return await this.walletInstance.splitUtxo(options);
  }

  async transferNft(toAddress, inscriptionId) {
    this.requireConnected();
    return await this.walletInstance.transferNft(toAddress, inscriptionId);
  }

  async watchAsset(assetOptions) {
    this.requireInstalled();
    return await this.walletInstance.watchAsset(assetOptions);
  }

  async mint(options) {
    this.requireConnected();
    // Ensure 'from' parameter is set
    if (!options.from) {
      options.from = this.address;
    }
    return await this.walletInstance.mint(options);
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
      debugLog('👤 OKX accounts changed');
      
      if (!accounts || accounts.length === 0) {
        this.address = null;
        this.publicKey = null;
        this.isConnected = false;
      } else {
        this.address = accounts[0];
      }
    });
    
    // Network changes
    wallet.on('networkChanged', (network) => {
      debugLog('🌐 OKX network changed');
    });
    
    debugLog('✅ OKX event listeners set up');
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

export default OKXProvider;
