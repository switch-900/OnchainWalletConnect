/**
 * Phantom Wallet Provider
 */

// Import from ordinal inscriptions (update sat numbers after inscribing)
import { BaseWalletProvider } from './01-base-provider.js';
import { normalizeNetwork, normalizePsbtOptions } from './02-normalizers.js';

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugLog = (...args) => {
  if (__nexusWalletDebugEnabled()) console.log(...args);
};

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) console.warn(...args);
};


export class PhantomProvider extends BaseWalletProvider {
  constructor() {
    super('Phantom');
    this.publicKey = null;
    this.paymentAddress = null;
    this.paymentPublicKey = null;
    
    this.walletInstance = typeof window !== 'undefined' ? window.phantom?.bitcoin : null;
    
    // Feature flags - Phantom ONLY supports these Bitcoin features:
    this.features = {
      connect: true,
      getAddress: true,
      getPublicKey: true,
      getBalance: true,
      getNetwork: true,
      signMessage: true,
      signPsbt: true,              // signPSBT (uppercase) supported
      sendBitcoin: true,
      eventListeners: true
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
      const accounts = await this.walletInstance.requestAccounts();
      
      if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('No accounts returned from Phantom wallet');
      }

      debugLog('🔍 Phantom accounts received');
      debugLog('🔍 Number of accounts:', accounts.length);
      
      // 🔥 CRITICAL: Phantom has TWO modes:
      // 1. Native Phantom wallet: returns accounts with 'purpose' field (ordinals/payment)
      // 2. Imported address: returns single account without 'purpose' field
      
      const hasOrdinalsAccount = accounts.find(acc => acc.purpose === 'ordinals');
      const hasPaymentAccount = accounts.find(acc => acc.purpose === 'payment');
      
      if (hasOrdinalsAccount && hasPaymentAccount) {
        // Mode 1: Dual address wallet (native Phantom)
        debugLog('✅ Phantom dual address mode detected');
        this.address = hasOrdinalsAccount.address;
        this.publicKey = hasOrdinalsAccount.publicKey;
        this.paymentAddress = hasPaymentAccount.address;
        this.paymentPublicKey = hasPaymentAccount.publicKey;
      } else {
        // Mode 2: Single address wallet (imported or legacy)
        debugLog('✅ Phantom single address mode detected (imported wallet or legacy)');
        const account = accounts[0];
        
        // Use the same address for both ordinals and payment
        // This is safe - the system will handle address routing automatically
        this.address = account.address;
        this.publicKey = account.publicKey;
        this.paymentAddress = account.address;  // Same address
        this.paymentPublicKey = account.publicKey;
        
        debugWarn('⚠️ Using same address for ordinals and payment');
        debugWarn('⚠️ For better security, consider creating a native Phantom wallet');
      }
      
      this.isConnected = true;
      
      debugLog('✅ Phantom connected');
      
      return { 
        address: this.address,
        // 🔥 CRITICAL: For single-address wallets, DON'T set ordinalsAddress
        // This tells the system it's a single-address wallet (like Unisat)
        ordinalsAddress: this.address === this.paymentAddress ? null : this.address,
        paymentAddress: this.paymentAddress,
        publicKey: this.publicKey,
        paymentPublicKey: this.paymentPublicKey
      };
    } catch (error) {
      debugWarn('❌ Phantom connection failed');
      throw error;
    }
  }

  async getAddress() {
    this.requireConnected();
    
    try {
      const accounts = await this.walletInstance.getAccounts();
      return accounts[0].address;
    } catch (error) {
      debugWarn('❌ Failed to get address');
      return this.address;
    }
  }

  async getPublicKey() {
    this.requireConnected();
    return this.publicKey;
  }

  async getAccounts() {
    this.requireConnected();

    try {
      // Phantom Bitcoin API doesn't have getAccounts, but we can return the current address
      return [this.address];
    } catch (error) {
      debugWarn('❌ Failed to get accounts');
      throw error;
    }
  }

  // ========================================
  // SIGNING METHODS
  // ========================================

  async signMessage(message) {
    this.requireConnected();

    try {
      const signature = await this.walletInstance.signMessage(message);
      // Handle both formats: string or {signature: string}
      return typeof signature === 'string' ? signature : signature.signature;
    } catch (error) {
      debugWarn('❌ Failed to sign message');
      throw error;
    }
  }

  async signPsbt(psbtHex, options = {}) {
    this.requireConnected();

    try {
      debugLog('🔍 Phantom signPsbt called');

      const hasBuffer = () => (typeof Buffer !== 'undefined' && Buffer && typeof Buffer.from === 'function');

      const hexToBytes = (hex) => {
        const s = String(hex || '').trim();
        if (!/^[0-9a-fA-F]+$/.test(s) || (s.length % 2 !== 0)) {
          throw new Error('Invalid hex string');
        }
        const out = new Uint8Array(s.length / 2);
        for (let i = 0; i < s.length; i += 2) {
          out[i / 2] = parseInt(s.slice(i, i + 2), 16);
        }
        return out;
      };

      const bytesToHex = (bytes) => {
        const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let hex = '';
        for (let i = 0; i < arr.length; i++) {
          hex += arr[i].toString(16).padStart(2, '0');
        }
        return hex;
      };

      const bytesToBase64 = (bytes) => {
        const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (hasBuffer()) {
          return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
        }
        if (typeof btoa !== 'function') {
          throw new Error('Base64 encoding not available');
        }
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < arr.length; i += chunk) {
          const sub = arr.subarray(i, i + chunk);
          binary += String.fromCharCode.apply(null, Array.from(sub));
        }
        return btoa(binary);
      };

      const base64ToBytes = (b64) => {
        const s = String(b64 || '').trim();
        if (hasBuffer()) {
          const buf = Buffer.from(s, 'base64');
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        if (typeof atob !== 'function') {
          throw new Error('Base64 decoding not available');
        }
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };

      // 🔥 CRITICAL FIX: Phantom expects PSBT in BASE64 format, not hex!
      // The error "A psbt hex is required" is misleading - it actually wants base64
      // See: https://docs.phantom.app/bitcoin/signing-transactions
      
      // Per Phantom docs, signPSBT expects a Uint8Array of serialized PSBT bytes.
      // We'll prepare three representations and prefer Uint8Array when available.
      let psbtBytes = null;      // Uint8Array
      let psbtBase64 = null;     // string base64 (for older builds)
      let psbtOriginal = psbtHex; // whatever was provided

      try {
        if (typeof psbtHex === 'string' && psbtHex.toLowerCase().startsWith('70736274')) {
          // Hex string -> bytes/base64
          psbtBytes = hexToBytes(psbtHex);
          psbtBase64 = bytesToBase64(psbtBytes);
          debugLog('🧪 Phantom PSBT prepared from HEX');
        } else if (typeof psbtHex === 'string' && psbtHex.startsWith('cHNidP')) {
          // Base64 -> bytes
          psbtBytes = base64ToBytes(psbtHex);
          psbtBase64 = psbtHex;
          debugLog('🧪 Phantom PSBT prepared from BASE64');
        } else if (psbtHex instanceof Uint8Array) {
          psbtBytes = psbtHex;
          psbtBase64 = bytesToBase64(psbtHex);
          debugLog('🧪 Phantom PSBT provided as Uint8Array');
        }
      } catch (convErr) {
        debugWarn('⚠️ PSBT conversion warning:', convErr?.message);
      }
      
      // Normalize cross-wallet options → Phantom shape using shared normalizer.
      // Do NOT overwrite per-input addresses; Phantom can have separate ordinals/payment accounts.
      // Provide a defaultAddress fallback for older call sites.
      const normalizedOptions = normalizePsbtOptions(
        { ...options, defaultAddress: this.address, paymentAddress: this.paymentAddress },
        'Phantom'
      );

      debugLog('🔍 Phantom normalized options prepared');

      // Phantom has multiple invocation styles across versions:
      // 1) signPSBT(psbtBase64) - simplest, no options
      // 2) signPSBT(psbtBase64, options) - with options if wallet supports
      // 3) request({ method: 'signPSBT', params: [...] })
      let signedPsbt;
      const tryUpper = async (opts = null) => {
        debugLog('🔏 Using signPSBT (uppercase)' + (opts ? ' with options...' : '...'));
        const arg = psbtBytes || psbtBase64 || psbtOriginal;
        if (opts) {
          return await this.walletInstance.signPSBT(arg, opts);
        } else {
          return await this.walletInstance.signPSBT(arg);
        }
      };
      const tryLower = async (opts = null) => {
        debugLog('🔏 Using signPsbt (lowercase)' + (opts ? ' with options...' : '...'));
        const arg = psbtBytes || psbtBase64 || psbtOriginal;
        if (opts) {
          return await this.walletInstance.signPsbt(arg, opts);
        } else {
          return await this.walletInstance.signPsbt(arg);
        }
      };
      const tryRequest = async () => {
        if (typeof this.walletInstance.request !== 'function') {
          debugWarn('⚠️ request() not available on Phantom provider');
          throw new Error('Phantom Bitcoin API does not support request() method. Please ensure Phantom wallet is updated.');
        }
        debugLog('🔏 Using request("signPSBT") EIP-1193 style...');
        // Try params as object first
        try {
          const res = await this.walletInstance.request({
            method: 'signPSBT',
            params: { psbt: (psbtBytes || psbtBase64 || psbtOriginal), options: normalizedOptions }
          });
          return res;
        } catch (eObj) {
          debugWarn('⚠️ request({params: object}) failed, trying array params');
          // Then try array params shape
          const res2 = await this.walletInstance.request({
            method: 'signPSBT',
            params: [(psbtBytes || psbtBase64 || psbtOriginal), normalizedOptions]
          });
          return res2;
        }
      };

      if (typeof this.walletInstance.signPSBT === 'function') {
        try {
          // Try with NO options first (Phantom is picky about parameters)
          signedPsbt = await tryUpper(null);
        } catch (e1) {
          debugWarn('⚠️ signPSBT (no options) threw:', e1?.message);
          
          // Try with normalized options
          try {
            debugWarn('⚠️ Retrying signPSBT with normalized options...');
            signedPsbt = await tryUpper(normalizedOptions);
          } catch (e2) {
            debugWarn('⚠️ signPSBT with options failed, trying with empty object');
            try {
              // Try with empty options object
              signedPsbt = await tryUpper({});
            } catch (e3) {
              debugWarn('⚠️ All signPSBT attempts failed, trying lowercase method');
              if (typeof this.walletInstance.signPsbt === 'function') {
                try {
                  signedPsbt = await tryLower(null);
                } catch (e4) {
                  try {
                    signedPsbt = await tryLower(normalizedOptions);
                  } catch (e5) {
                    debugWarn('⚠️ No lowercase signPsbt available, trying request API...');
                    try {
                      signedPsbt = await tryRequest();
                    } catch (e6) {
                      debugWarn('❌ All Phantom signing methods exhausted');
                      throw new Error(`Phantom signing failed: ${e1.message}. Tried signPSBT and signPsbt methods.`);
                    }
                  }
                }
              } else {
                debugWarn('⚠️ No lowercase signPsbt available, trying request API...');
                try {
                  signedPsbt = await tryRequest();
                } catch (e4) {
                  debugWarn('❌ All Phantom signing methods exhausted');
                  throw new Error(`Phantom signing failed: ${e1.message}. Tried signPSBT, signPsbt, and request() methods.`);
                }
              }
            }
          }
        }
      } else if (typeof this.walletInstance.signPsbt === 'function') {
        try {
          signedPsbt = await tryLower(null);
        } catch (e1) {
          try {
            signedPsbt = await tryLower(normalizedOptions);
          } catch (e2) {
            throw new Error(`Phantom signPsbt failed: ${e2.message}`);
          }
        }
      } else {
        // Fall back to request() if direct methods are missing
        try {
          signedPsbt = await tryRequest();
        } catch (e) {
          throw new Error(`Phantom wallet does not have signPSBT, signPsbt, or request() methods available. Please update your Phantom wallet.`);
        }
      }

      debugLog('✅ Phantom signed PSBT');
      
      // 🔥 CRITICAL: Phantom returns Uint8Array, not string!
          let resultHex;
      
      if (signedPsbt instanceof Uint8Array) {
        // Convert Uint8Array to hex
        debugLog('🔄 Converting Uint8Array to HEX...');
        resultHex = bytesToHex(signedPsbt);
        debugLog('✅ Converted to hex');
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(signedPsbt)) {
        // Convert Buffer to hex
        debugLog('Converting Buffer to HEX...');
        resultHex = signedPsbt.toString('hex');
      } else if (typeof signedPsbt === 'string') {
        // Already a string - check if base64 or hex
        if (signedPsbt.startsWith('cHNidP')) {
          // Base64 -> hex
          debugLog('🔄 Converting BASE64 to HEX...');
          resultHex = bytesToHex(base64ToBytes(signedPsbt));
        } else {
          // Already hex
          resultHex = signedPsbt;
        }
      } else if (signedPsbt?.signedPsbtHex) {
        // Object with signedPsbtHex property
        resultHex = signedPsbt.signedPsbtHex;
      } else if (signedPsbt?.signedPsbt) {
        // Object with signedPsbt property
        resultHex = signedPsbt.signedPsbt;
      } else if (signedPsbt?.psbt) {
        // Object with psbt property
        resultHex = signedPsbt.psbt;
      } else {
        debugWarn('❌ Unknown signed PSBT format');
        throw new Error('Phantom returned unexpected PSBT format');
      }

      debugLog('✅ Final PSBT hex prepared');
      return resultHex;
    } catch (error) {
      debugWarn('❌ Failed to sign PSBT:', error?.message);
      throw error;
    }
  }

  // ========================================
  // BALANCE & NETWORK METHODS
  // ========================================

  async getBalance() {
    this.requireConnected();
    
    try {
      // Phantom Bitcoin API doesn't have direct getBalance
      // We need to work with what's available or return a placeholder
      debugWarn('⚠️ Phantom Bitcoin API has limited balance support');
      return {
        confirmed: 0,
        unconfirmed: 0, 
        total: 0
      };
    } catch (error) {
      debugWarn('❌ Failed to get balance');
      throw error;
    }
  }

  async getNetwork() {
    this.requireInstalled();
    
    try {
      const network = await this.walletInstance.getNetwork();
      return normalizeNetwork(network);
    } catch (error) {
      debugWarn('❌ Failed to get network');
      return 'livenet';
    }
  }

  // ========================================
  // TRANSACTION METHODS
  // ========================================

  async sendBitcoin(recipientAddress, amount, options = {}) {
    this.requireConnected();
    BaseWalletProvider.validateSendParams(recipientAddress, amount);
    
    try {
      const response = await this.walletInstance.sendTransfer({
        recipientAddress,
        amount,
        ...options
      });

      debugLog('✅ Phantom transaction sent');
      return response;
    } catch (error) {
      debugWarn('❌ Failed to send Bitcoin');
      throw error;
    }
  }

  // ========================================
  // EVENT LISTENERS
  // ========================================

  setupEventListeners() {
    if (!this.isInstalled()) {
      return;
    }

    // Listen for account changes
    this.walletInstance.on('accountsChanged', (accounts) => {
      debugLog('👤 Phantom accounts changed');
      if (accounts && accounts.length > 0) {
        this.address = accounts[0].address;
        this.publicKey = accounts[0].publicKey;
      } else {
        this.address = null;
        this.publicKey = null;
        this.isConnected = false;
      }
    });

    debugLog('✅ Phantom event listeners set up');
  }

  removeEventListeners() {
    if (!this.isInstalled()) {
      return;
    }

    // Remove all event listeners
    if (typeof this.walletInstance.removeAllListeners === 'function') {
      this.walletInstance.removeAllListeners('accountsChanged');
    }
    debugLog('✅ Phantom event listeners removed');
  }
}

export default PhantomProvider;
