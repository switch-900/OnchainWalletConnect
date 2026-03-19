/**
 * Magic Eden Wallet Provider
 */

// Import from ordinal inscriptions
// Import from ordinal inscriptions (update sat numbers after inscribing)
import { BaseWalletProvider } from './01-base-provider.js';
import { createUnsecuredToken } from './03-wallet-connector.js';

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugLog = (...args) => {
  if (__nexusWalletDebugEnabled()) console.log(...args);
};

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) console.warn(...args);
};

export class MagicEdenProvider extends BaseWalletProvider {
  constructor() {
    super('MagicEden');
    this.paymentAddress = null;
    this.ordinalsAddress = null;
    
    this.walletInstance = this.getProvider();
    
    // Feature flags - Magic Eden capabilities
    this.features = {
      connect: true,
      getAddress: true,
      getPublicKey: false,
      getBalance: false,
      getNetwork: true,
      switchNetwork: false,
      signMessage: true,
      signPsbt: true,
      signPsbts: true,
      signTransaction: true,
      pushPsbt: false,
      pushTx: false,
      sendBitcoin: true,
      sendInscription: false,
      getInscriptions: false,
      getAllInscriptions: false,
      inscribe: false,
      brc20: { transfer: false, deploy: false, mint: false },
      runes: { send: false, mint: false, etch: false },
      atomicals: { transfer: false, mint: false },
      arc20: { transfer: false },
      jwtAuth: true,            // Uses JWT token authentication (UNIQUE)
      hardwareDetection: true   // Has isHardware() method
    };
  }

  getProvider() {
    if (typeof window === 'undefined') return null;
    
    // Check window.magicEden.bitcoin exists
    if (window.magicEden?.bitcoin?.isMagicEden) {
      return window.magicEden.bitcoin;
    }
    
    // Check if Magic Eden took over window.BitcoinProvider
    if (window.BitcoinProvider?.isMagicEden) {
      return window.BitcoinProvider;
    }
    
    return null;
  }

  isInstalled() {
    return !!this.walletInstance;
  }

  // ========================================
  // CONNECTION METHODS
  // ========================================

  async connect() {
    this.requireInstalled();

    const provider = this.walletInstance;

    // Important: Detect multi-wallet conflicts early
    const hasXverse = typeof window.XverseProviders !== 'undefined' || typeof window.BitcoinProvider?.request === 'function';
    const hasLeather = typeof window.LeatherProvider !== 'undefined';
    
    if ((hasXverse || hasLeather) && !provider?.isMagicEden) {
      throw new Error(
        ' Wallet conflict detected\n\n' +
        'Magic Eden cannot coexist with other Bitcoin wallets.\n' +
        `Detected: ${hasXverse ? 'Xverse ' : ''}${hasLeather ? 'Leather' : ''}\n\n` +
        'SOLUTIONS:\n' +
        '1. Disable Xverse and Leather extensions\n' +
        '2. Refresh the page\n' +
        '3. Try again\n\n' +
        'OR use Xverse wallet instead (recommended for multi-wallet support)'
      );
    }

    if (!provider || !provider.isMagicEden) {
      throw new Error(
        ' Magic Eden wallet is installed but cannot be accessed.\n\n' +
        'This happens when multiple Bitcoin wallets are installed.\n\n' +
        'SOLUTION:\n' +
        '1. Disable Xverse and Leather extensions\n' +
        '2. Refresh the page\n' +
        '3. Try again\n\n' +
        'OR use Xverse wallet instead (recommended)'
      );
    }

    try {
      // Create JWT token for connection request
      const payload = {
        purposes: ['payment', 'ordinals'],
        message: 'Connect to view your Bitcoin addresses',
        network: { type: 'Mainnet' }
      };
      
      const request = createUnsecuredToken(payload);
      
      // Call Magic Eden's direct connect() method
      const response = await provider.connect(request);

      if (!response?.addresses || !Array.isArray(response.addresses)) {
        throw new Error('No addresses returned from Magic Eden wallet');
      }

      // Find payment and ordinals addresses
      const paymentAddress = response.addresses.find(a => a.purpose === 'payment');
      const ordinalsAddress = response.addresses.find(a => a.purpose === 'ordinals');

      if (!paymentAddress && !ordinalsAddress) {
        throw new Error('No valid addresses returned');
      }

      // Store the addresses
      this.paymentAddress = paymentAddress?.address;
      this.ordinalsAddress = ordinalsAddress?.address;
      this.address = ordinalsAddress?.address || paymentAddress?.address;
      this.publicKey = paymentAddress?.publicKey || ordinalsAddress?.publicKey;
      this.isConnected = true;

      debugLog('Magic Eden connected');

      return {
        address: this.address,
        paymentAddress: this.paymentAddress,
        ordinalsAddress: this.ordinalsAddress,
        publicKey: this.publicKey
      };
    } catch (error) {
      debugWarn('Magic Eden connection failed');
      throw error;
    }
  }

  async getAddress() {
    this.requireConnected();
    return this.address;
  }

  async getAccounts() {
    this.requireConnected();

    return [
      {
        address: this.paymentAddress,
        publicKey: this.publicKey,
        purpose: 'payment'
      },
      {
        address: this.ordinalsAddress,
        publicKey: this.publicKey,
        purpose: 'ordinals'
      }
    ].filter(account => account.address);
  }

  /**
   * Expose provider state for SDK safety checks (segregated wallet detection, etc.)
   * Mirrors the shape expected by inscriber.js (paymentAddress, ordinalsAddress)
   */
  getState() {
    // Magic Eden often uses a single address for both; fall back to this.address where needed
    const paymentAddress = this.paymentAddress || this.address || null;
    const ordinalsAddress = this.ordinalsAddress || this.address || null;
    return {
      wallet: 'MagicEden',
      connected: !!this.isConnected,
      network: 'mainnet',
      paymentAddress,
      ordinalsAddress,
      paymentPublicKey: this.publicKey || null,
      ordinalsPublicKey: this.publicKey || null,
      address: this.address || ordinalsAddress || paymentAddress || null,
    };
  }

  async getBalance() {
    this.requireConnected();

    // Magic Eden wallet does not support getBalance via their API
    debugLog('Magic Eden does not support getBalance - use their web interface');
    return { confirmed: 0, unconfirmed: 0, total: 0 };
  }

  async getNetwork() {
    return 'mainnet';
  }

  // ========================================
  // SIGNING METHODS
  // ========================================

  async signMessage(message) {
    this.requireConnected();

    try {
      // Create JWT token for sign message request
      const payload = {
        address: this.address,
        message,
        protocol: 'BIP322' // Default to BIP322, can use 'ECDSA' for legacy
      };
      
      const request = createUnsecuredToken(payload);
      
      // Call Magic Eden's direct signMessage() method
      const signature = await this.walletInstance.signMessage(request);

      debugLog('Magic Eden message signed');
      return signature;
    } catch (error) {
      debugWarn('Magic Eden sign message failed');
      throw new Error(`Message signing failed: ${error.message}`);
    }
  }

  async signPsbt(psbtInput, options = {}) {
    this.requireConnected();

    try {
      const isHexString = (s) => (typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0);

      const hexToBytes = (hex) => {
        const len = hex.length;
        const out = new Uint8Array(len / 2);
        for (let i = 0; i < len; i += 2) {
          out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        }
        return out;
      };

      const bytesToHex = (bytes) => {
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
      };

      const bytesToBase64 = (bytes) => {
        // Prefer Buffer when available (fast + handles large payloads)
        if (typeof Buffer !== 'undefined') {
          return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
        }
        // Fallback for environments without Buffer
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          const sub = bytes.subarray(i, i + chunk);
          binary += String.fromCharCode.apply(null, Array.from(sub));
        }
        return btoa(binary);
      };

      const base64ToBytes = (b64) => {
        if (typeof Buffer !== 'undefined') {
          const buf = Buffer.from(b64, 'base64');
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };

      const hexToBase64 = (hex) => bytesToBase64(hexToBytes(hex));
      const base64ToHex = (b64) => bytesToHex(base64ToBytes(b64));

      //  FIX: Magic Eden REQUIRES base64, but we might receive hex
      // Convert hex to base64 if needed
      let psbtBase64 = psbtInput;
      
      // Detect if input is hex (all hex chars, even length)
      if (isHexString(psbtInput)) {
        debugLog('Magic Eden: Converting PSBT from hex to base64...');
        psbtBase64 = hexToBase64(psbtInput);
      }
      
      // Determine which inputs to sign.
      // OODL and other flows may require signing multiple inputs with different addresses.
      const inputsToSign = (() => {
        const list = Array.isArray(options?.toSignInputs) ? options.toSignInputs : [];
        const byAddress = new Map();
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          const addr = item.address || this.ordinalsAddress || this.paymentAddress || this.address;
          const idx = Number(item.index);
          if (!addr || !Number.isFinite(idx) || idx < 0) continue;
          if (!byAddress.has(addr)) byAddress.set(addr, []);
          byAddress.get(addr).push(idx);
        }

        // If caller didn't specify anything, default to signing input 0 with the ordinals address.
        if (byAddress.size === 0) {
          const addr = this.ordinalsAddress || this.address;
          if (addr) byAddress.set(addr, [0]);
        }

        // Deduplicate indexes per address.
        return Array.from(byAddress.entries()).map(([address, signingIndexes]) => ({
          address,
          signingIndexes: Array.from(new Set(signingIndexes)).sort((a, b) => a - b),
        }));
      })();
      
      debugLog('Magic Eden: Signing PSBT...');
      debugLog('inputsToSign groups:', inputsToSign.length);
      
      // Create JWT token for sign transaction request
      const payload = {
        network: { type: 'Mainnet' },
        message: 'Sign inscription transaction',
        psbtBase64,
        broadcast: false, // Don't broadcast, just sign
        inputsToSign
      };
      
      const request = createUnsecuredToken(payload);
      
      // Call Magic Eden's direct signTransaction() method
      const result = await this.walletInstance.signTransaction(request);

      debugLog('Magic Eden PSBT signed');
      
      // Return the signed PSBT in the SAME format as input
      if (result?.psbtBase64) {
        // If input was hex, return hex; if base64, return base64
        if (isHexString(psbtInput)) {
          return base64ToHex(result.psbtBase64);
        }
        return result.psbtBase64;
      }
      
      throw new Error('No signed PSBT returned from Magic Eden');
    } catch (error) {
      debugWarn('Magic Eden sign PSBT failed');
      
      // Better error messages
      if (error.message?.includes('Magic Number')) {
        throw new Error('PSBT format error: Magic Eden expects base64 format. This error has been fixed - please try again.');
      }
      
      throw new Error(`PSBT signing failed: ${error.message}`);
    }
  }

  async signPsbts(psbtInputs, optionsArray = []) {
    this.requireConnected();

    try {
      debugLog(`Magic Eden: Signing ${psbtInputs.length} PSBTs...`);
      
      // Sign each PSBT sequentially (Magic Eden doesn't have batch signing)
      const results = [];
      for (let i = 0; i < psbtInputs.length; i++) {
        const psbtInput = psbtInputs[i];
        const options = Array.isArray(optionsArray) ? (optionsArray[i] || {}) : optionsArray;
        
        debugLog(`  Signing PSBT ${i + 1}/${psbtInputs.length}...`);
        const signedPsbt = await this.signPsbt(psbtInput, options);
        results.push(signedPsbt);
      }
      
      debugLog(`Magic Eden: All ${results.length} PSBTs signed`);
      return results;
    } catch (error) {
      debugWarn('Magic Eden sign PSBTs failed');
      throw new Error(`Batch PSBT signing failed: ${error.message}`);
    }
  }

  async signTransaction(psbtBase64) {
    this.requireConnected();

    const result = await this.walletInstance.signTransaction(psbtBase64);
    debugLog('Transaction signed via Magic Eden');
    return result;
  }

  async signMultipleTransactions(psbtBase64s) {
    this.requireConnected();

    const results = await this.walletInstance.signMultipleTransactions(psbtBase64s);
    debugLog(`Magic Eden: ${results.length} transactions signed`);
    return results;
  }

  // ========================================
  // TRANSACTION METHODS
  // ========================================

  async sendBitcoin(toAddress, amount) {
    this.requireConnected();
    BaseWalletProvider.validateSendParams(toAddress, amount);

    try {
      // amount is always in satoshis (enforced by validateSendParams integer check).
      const amountSats = amount;
      
      // Use payment address as sender (required by Magic Eden)
      const senderAddress = this.paymentAddress;
      if (!senderAddress) {
        throw new Error('Payment address not available. Please reconnect wallet.');
      }
      
      // Create JWT token for send BTC request
      const payload = {
        recipients: [{
          address: toAddress,
          amountSats: amountSats
        }],
        senderAddress: senderAddress
      };
      
      const request = createUnsecuredToken(payload);
      
      // Call Magic Eden's direct sendBtcTransaction() method
      const txid = await this.walletInstance.sendBtcTransaction(request);

      debugLog('Magic Eden BTC sent');
      return txid;
    } catch (error) {
      debugWarn('Magic Eden send BTC failed');
      
      // Improve error messages
      let errorMessage = error.message || 'Unknown error';
      
      if (errorMessage.includes('validation')) {
        errorMessage = 'Invalid address format. Please check the recipient address.';
      } else if (errorMessage.includes('rejected')) {
        errorMessage = 'Transaction was rejected by user';
      } else if (errorMessage.includes('insufficient')) {
        errorMessage = 'Insufficient balance to complete transaction';
      }
      
      throw new Error(`Send transaction failed: ${errorMessage}`);
    }
  }

  // ========================================
  // INSCRIPTION METHODS
  // ========================================

  async getInscriptions(offset = 0, limit = 100) {
    this.requireConnected();

    // Magic Eden wallet doesn't provide direct inscription access
    return { list: [], total: 0 };
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  async isHardware() {
    if (!this.walletInstance) {
      throw new Error('Provider not initialized');
    }

    try {
      return await this.walletInstance.isHardware();
    } catch (error) {
      debugWarn('isHardware method not supported');
      return false;
    }
  }

  async call(method, params = {}) {
    if (!this.walletInstance || !this.walletInstance.call) {
      throw new Error('Magic Eden RPC call method not available');
    }

    try {
      debugLog(`Magic Eden RPC call: ${method}`);
      const result = await this.walletInstance.call(method, params);
      debugLog('Magic Eden RPC call succeeded');
      return result;
    } catch (error) {
      debugWarn('Magic Eden RPC call failed');
      throw new Error(`RPC call failed: ${error.message}`);
    }
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
      debugLog('Magic Eden accounts changed');
      
      if (!accounts || accounts.length === 0) {
        this.paymentAddress = null;
        this.ordinalsAddress = null;
        this.isConnected = false;
      } else {
        // Magic Eden returns address strings
        this.paymentAddress = accounts[0];
        this.ordinalsAddress = accounts[0];
      }
    });
    
    debugLog('Magic Eden event listeners set up');
  }

  removeEventListeners() {
    if (!this.isInstalled()) return;
    
    const wallet = this.walletInstance;
    if (wallet && wallet.removeAllListeners) {
      wallet.removeAllListeners('accountsChanged');
    }
  }
}

export default MagicEdenProvider;
