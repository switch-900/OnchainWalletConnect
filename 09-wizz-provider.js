/**
 * Wizz Wallet Provider
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

// Wizz inscription type constants
const WIZZ_INSCRIPTION_TYPES = {
  BRC20_MINT: 50,
  BRC20_TRANSFER: 51,
  BRC20_DEPLOY: 60,
  PLAIN_TEXT: 61,
  IMAGE: 62
};


export class WizzProvider extends BaseWalletProvider {
  constructor() {
    super('Wizz');
    
    this.walletInstance = typeof window !== 'undefined' ? window.wizz : null;
    
    // Feature flags - Wizz capabilities (most advanced multi-protocol)
    this.features = {
      connect: true,
      getAddress: true,
      getPublicKey: true,
      getBalance: true,
      getNetwork: true,
      switchNetwork: true,
      signMessage: true,
      signPsbt: true,
      signPsbts: false,
      pushPsbt: true,
      pushTx: true,              // Raw transaction broadcast (better for dependent txs)
      sendBitcoin: true,
      sendInscription: false,
      getInscriptions: true,
      getAllInscriptions: true,
      inscribe: true,
      brc20: { transfer: true, deploy: true, mint: true },
      runes: { send: true, mint: false, etch: false },
      atomicals: { transfer: true, mint: true },
      arc20: { transfer: true },
      biHelix: true,            // BiHelix support (UNIQUE to Wizz)
      cpfp: true,               // CPFP support (requestCPFP)
      mempoolInjection: true,   // injectMempool() (UNIQUE to Wizz)
      bip322: true              // BIP322 message verification
    };
  }

  isInstalled() {
    return !!this.walletInstance;
  }

  // ========================================
  // CONNECTION METHODS
  // ========================================

  async connect() {
    this.requireInstalled();

    try {
      debugLog('🔍 Connecting to Wizz wallet...');
      const provider = this.walletInstance;
      
      // Wizz returns simple array of address strings OR object with address + publicKey
      let result = null;
      
      if (typeof provider.connect === 'function') {
        debugLog('🔍 Using connect() method...');
        result = await provider.connect();
      }
      else if (typeof provider.requestAccounts === 'function') {
        debugLog('🔍 Using requestAccounts() method...');
        result = await provider.requestAccounts();
      }
      else if (typeof provider.getAccounts === 'function') {
        debugLog('🔍 Using getAccounts() method...');
        result = await provider.getAccounts();
      }
      else {
        throw new Error('Wizz wallet has no connection methods available');
      }
      
      debugLog('🔍 Wizz connect returned');
      
      if (!result) {
        throw new Error('No response from Wizz wallet');
      }
      
      // Handle response format
      if (typeof result === 'object' && result.address) {
        // Object format: {address: "...", publicKey: "..."}
        this.address = result.address;
        this.publicKey = result.publicKey;
      } else if (Array.isArray(result) && result.length > 0) {
        // Array format: ["bc1q..."]
        this.address = result[0];
      } else if (typeof result === 'string') {
        // String format: "bc1q..."
        this.address = result;
      } else {
        throw new Error('Unexpected response format from Wizz wallet');
      }
      
      if (!this.address) {
        throw new Error('Could not extract address from Wizz response');
      }
      
      // Try to get publicKey if not already set
      if (!this.publicKey && typeof provider.getPublicKey === 'function') {
        try {
          this.publicKey = await provider.getPublicKey();
          debugLog('   📝 Retrieved Public Key');
        } catch (e) {
          debugWarn('⚠️ Could not get public key');
        }
      }
      
      this.isConnected = true;
      
      debugLog('✅ Wizz connected');
      
      return { 
        address: this.address,
        publicKey: this.publicKey
      };
    } catch (error) {
      debugWarn('❌ Wizz connection failed');
      
      // Provide helpful error messages
      if (error.code === -32603) {
        throw new Error('Wizz wallet error: Please unlock your wallet and refresh the page');
      }
      
      if (error.message?.includes('User rejected')) {
        throw new Error('Connection request was rejected');
      }
      
      throw error;
    }
  }

  async getAddress() {
    this.requireConnected();
    const accounts = await this.walletInstance.getAccounts();
    return accounts[0];
  }

  async getPublicKey() {
    this.requireConnected();
    return await this.walletInstance.getPublicKey();
  }

  async getAccounts() {
    this.requireInstalled();
    return await this.walletInstance.getAccounts();
  }

  async getBalance() {
    this.requireConnected();

    const balance = await this.walletInstance.getBalance();
    return normalizers.balance(balance, 'Wizz');
  }

  async getNetwork() {
    this.requireInstalled();

    try {
      const network = await this.walletInstance.getNetwork();
      return normalizers.network(network);
    } catch (error) {
      debugWarn('❌ Failed to get network');
      return 'livenet';
    }
  }

  async switchNetwork(network) {
    this.requireInstalled();
    await this.walletInstance.switchNetwork(network);
    debugLog('✅ Wizz network switched');
  }

  async getChain() {
    this.requireInstalled();
    return await this.walletInstance.getChain();
  }

  async switchChain(chain) {
    this.requireInstalled();
    await this.walletInstance.switchChain(chain);
    debugLog('✅ Wizz chain switched');
  }

  // ========================================
  // SIGNING METHODS
  // ========================================

  async signMessage(message, type = 'ecdsa') {
    this.requireConnected();
    return await this.walletInstance.signMessage(message, type);
  }

  async verifyMessage(message, signature, address) {
    this.requireInstalled();
    return await this.walletInstance.verifyMessage(message, signature, address);
  }

  async verifyMessageOfBIP322Simple(address, message, signature) {
    this.requireInstalled();
    return await this.walletInstance.verifyMessageOfBIP322Simple(address, message, signature);
  }

  async signPsbt(psbtHex, options = {}) {
    this.requireConnected();
    return await this.walletInstance.signPsbt(psbtHex, options);
  }

  async pushPsbt(psbtHex) {
    this.requireConnected();
    const txid = await this.walletInstance.pushPsbt(psbtHex);
    debugLog('✅ Wizz PSBT broadcasted');
    return txid;
  }

  async pushTx(txHex) {
    this.requireConnected();
    
    // Wizz expects {rawtx: "..."} format
    const txid = await this.walletInstance.pushTx({ rawtx: txHex });
    debugLog('✅ Wizz raw TX broadcasted');
    return txid;
  }

  // ========================================
  // TRANSACTION METHODS
  // ========================================

  async sendBitcoin(toAddress, amount, options = {}) {
    this.requireConnected();
    BaseWalletProvider.validateSendParams(toAddress, amount);
    const txid = await this.walletInstance.sendBitcoin(toAddress, amount, options);
    debugLog('✅ Wizz transaction sent');
    return txid;
  }

  async getBitcoinUtxos() {
    this.requireConnected();
    return await this.walletInstance.getBitcoinUtxos();
  }

  async injectMempool(txHex) {
    this.requireConnected();
    return await this.walletInstance.injectMempool(txHex);
  }

  async requestCPFP(txid) {
    this.requireConnected();
    const newTxid = await this.walletInstance.requestCPFP(txid);
    debugLog('✅ Wizz CPFP transaction created');
    return newTxid;
  }

  // ========================================
  // INSCRIPTION METHODS
  // ========================================

  async getInscriptions(offset = 0, limit = 100) {
    this.requireConnected();

    try {
      const provider = this.walletInstance;
      let inscriptions = [];
      
      // Try different methods to get inscriptions
      if (typeof provider.getInscriptions === 'function') {
        debugLog('📦 Using getInscriptions method...');
        const response = await provider.getInscriptions(offset, limit);
        
        // Handle different response formats
        if (Array.isArray(response)) {
          inscriptions = response;
        } else if (response && response.list) {
          inscriptions = response.list;
        } else if (response && response.inscriptions) {
          inscriptions = response.inscriptions;
        } else if (response && response.result) {
          inscriptions = response.result.inscriptions || response.result.list || [];
        }
      }
      else if (typeof provider.getOrdinals === 'function') {
        debugLog('📦 Using getOrdinals method...');
        const response = await provider.getOrdinals(offset, limit);
        inscriptions = Array.isArray(response) ? response : (response.list || response.inscriptions || []);
      }
      else {
        debugWarn('⚠️ Wizz does not support inscription fetching');
        return { list: [], total: 0 };
      }

      debugLog(`📦 Wizz returned ${inscriptions.length} inscriptions`);

      return {
        list: inscriptions.map(i => normalizers.inscription(i, 'Wizz')),
        total: inscriptions.length
      };
    } catch (error) {
      debugWarn('❌ Failed to fetch Wizz inscriptions');
      return { list: [], total: 0 };
    }
  }

  async getInscriptionsByAddress(address, offset = 0, limit = 100) {
    this.requireInstalled();
    return await this.walletInstance.getInscriptionsByAddress(address, offset, limit);
  }

  async getAssets() {
    this.requireConnected();
    return await this.walletInstance.getAssets();
  }

  async inscribe(content, options = {}) {
    this.requireConnected();

    try {
      const {
        contentType = 'text/plain;charset=utf-8',
        encoding = 'utf8',
        feeRate,
        receiveAddress,
        serviceFee = 0,
        metadata
      } = options;

      const inscriptionOptions = {
        type: WIZZ_INSCRIPTION_TYPES.PLAIN_TEXT,
        from: this.address,
        inscriptions: [{
          contentType,
          body: content
        }]
      };

      // Add fee rate if specified
      if (feeRate) {
        inscriptionOptions.feeRate = feeRate;
      }

      // For BRC-20, use appropriate type
      if (contentType.includes('brc-20') || (metadata && metadata.brc20)) {
        inscriptionOptions.type = WIZZ_INSCRIPTION_TYPES.BRC20_TRANSFER;
        const brc20Data = metadata.brc20 || JSON.parse(content);
        inscriptionOptions.tick = brc20Data.tick;
      }

      // For images, use image type
      if (contentType.startsWith('image/')) {
        inscriptionOptions.type = WIZZ_INSCRIPTION_TYPES.IMAGE;
      }

      const result = await this.walletInstance.inscribe(inscriptionOptions);
      debugLog('✅ Wizz inscription created');
      
      return {
        inscriptionId: result.inscriptionId || result.revealTxs?.[0],
        txId: result.commitTx || result.txId,
        revealTxIds: result.revealTxs,
        commitTxFee: result.commitTxFee,
        revealTxFees: result.revealTxFees
      };
    } catch (error) {
      debugWarn('❌ Wizz inscribe error');
      throw new Error(`Inscription failed: ${error.message}`);
    }
  }

  async requestMint(mintData) {
    this.requireConnected();
    return await this.walletInstance.requestMint(mintData);
  }

  // ========================================
  // PROTOCOL-SPECIFIC METHODS
  // ========================================

  // ARC-20 Methods
  async sendARC20(toAddress, ticker, amount) {
    this.requireConnected();
    const txid = await this.walletInstance.sendARC20(toAddress, ticker, amount);
    debugLog('✅ Wizz ARC-20 sent');
    return txid;
  }

  // Atomicals Methods
  async sendAtomicals(atomicalsData) {
    this.requireConnected();
    const txid = await this.walletInstance.sendAtomicals(atomicalsData);
    debugLog('✅ Wizz Atomicals sent');
    return txid;
  }

  async isAtomicalsEnabled() {
    this.requireInstalled();
    return await this.walletInstance.isAtomicalsEnabled();
  }

  // BiHelix Methods
  async isBiHelixAddress(address) {
    this.requireInstalled();
    return await this.walletInstance.isBiHelixAddress(address);
  }

  async getBiHelixDescriptor() {
    this.requireConnected();
    return await this.walletInstance.getBiHelixDescriptor();
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  async viewAddress(address) {
    this.requireInstalled();
    await this.walletInstance.viewAddress(address);
  }

  async getVersion() {
    this.requireInstalled();
    return await this.walletInstance.getVersion();
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
      debugLog('👤 Wizz accounts changed');
      
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
      debugLog('🌐 Wizz network changed');
    });
    
    debugLog('✅ Wizz event listeners set up');
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

export default WizzProvider;
