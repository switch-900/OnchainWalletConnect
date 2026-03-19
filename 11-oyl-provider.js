/**
 * Oyl Wallet Provider
 */

// Import from ordinal inscriptions
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


export class OylProvider extends BaseWalletProvider {
  constructor() {
    super('Oyl');
    this.paymentAddress = null;
    this.ordinalsAddress = null;
    this.paymentPublicKey = null;
    this.ordinalsPublicKey = null;
    
    this.walletInstance = typeof window !== 'undefined' ? window.oyl : null;
    
    // Feature flags - Oyl capabilities
    this.features = {
      connect: true,
      getAddress: true,
      getPublicKey: false,
      getBalance: true,
      getNetwork: true,
      switchNetwork: true,
      signMessage: true,
      signPsbt: true,
      signPsbts: true,
      pushPsbt: true,
      pushTx: false,
      sendBitcoin: true,
      sendInscription: false,
      getInscriptions: true,
      getAllInscriptions: true,
      inscribe: false,
      brc20: { transfer: false, deploy: false, mint: false },
      runes: { send: false, mint: false, etch: false },
      atomicals: { transfer: false, mint: false },
      arc20: { transfer: false },
      relayProvider: true       // sendToRelayProvider() available
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
      debugLog('Connecting to Oyl wallet...');
      const provider = this.walletInstance;
      
      // Oyl wallet uses getAddresses() which returns a structured object.
      // Known shapes in the wild include:
      // { taproot, nativeSegwit, nestedSegwit, legacy }
      // and sometimes key-casing variants like nativeSegWit / nestedSegWit.
      const accounts = await provider.getAddresses();

      debugLog('Oyl addresses received');
      
      if (!accounts) {
        throw new Error('No response from Oyl wallet');
      }
      
      const pickAccount = (...keys) => {
        for (const k of keys) {
          const a = accounts?.[k];
          if (a && typeof a === 'object' && typeof a.address === 'string' && a.address) return a;
        }
        return null;
      };

      const ordAcc = pickAccount('taproot', 'p2tr', 'ordinals', 'ordinal');
      const payAcc =
        pickAccount('nativeSegwit', 'nativeSegWit', 'p2wpkh', 'segwit', 'bech32', 'payment') ||
        pickAccount('nestedSegwit', 'nestedSegWit', 'p2shSegwit', 'nested', 'p2sh') ||
        pickAccount('legacy', 'p2pkh');

      // Use taproot (ordinals) as primary when present
      if (ordAcc) {
        this.address = ordAcc.address;
        this.ordinalsAddress = ordAcc.address;
        this.publicKey = ordAcc.publicKey;
        this.ordinalsPublicKey = ordAcc.publicKey;
      }

      // Prefer native segwit for payment UTXOs when present
      if (payAcc) {
        this.paymentAddress = payAcc.address;
        this.paymentPublicKey = payAcc.publicKey;
        if (!this.address) {
          this.address = payAcc.address;
          this.publicKey = payAcc.publicKey;
        }
      } else {
        // If payment isn't available, fall back to primary address.
        // This keeps single-account wallets functional, but may yield 0 UTXOs if user funds are on a different script type.
        debugWarn('Oyl did not return a payment account (native segwit/nested/legacy). Using primary address for payment operations.');
      }
      
      if (!this.address) {
        throw new Error('No valid address returned from Oyl wallet');
      }
      
      this.isConnected = true;

      debugLog('Oyl connected');
      
      return { 
        address: this.address,
        ordinalsAddress: this.ordinalsAddress,
        paymentAddress: this.paymentAddress,
        publicKey: this.publicKey,
        ordinalsPublicKey: this.ordinalsPublicKey,
        paymentPublicKey: this.paymentPublicKey
      };
    } catch (error) {
      debugWarn('Oyl connection failed');
      throw error;
    }
  }

  async disconnect() {
    this.requireInstalled();

    await this.walletInstance.disconnect();
    this.isConnected = false;
    this.address = null;
    this.ordinalsAddress = null;
    this.paymentAddress = null;
    this.publicKey = null;
    this.ordinalsPublicKey = null;
    this.paymentPublicKey = null;
    debugLog('Oyl disconnected');
  }

  async isConnectedCheck() {
    if (!this.isInstalled()) {
      return false;
    }

    try {
      return await this.walletInstance.isConnected();
    } catch (error) {
      return this.isConnected;
    }
  }

  async getAddress() {
    this.requireConnected();
    
    try {
      // Oyl uses getAddresses() not getAccounts()
      const accounts = await this.walletInstance.getAddresses();
      
      // Return taproot address (ordinals address)
      if (accounts && accounts.taproot && accounts.taproot.address) {
        return accounts.taproot.address;
      }
      
      // Fallback to stored address
      return this.address;
    } catch (error) {
      debugWarn('Oyl: failed to get address');
      return this.address;
    }
  }

  async getAccounts() {
    this.requireInstalled();

    try {
      // Oyl uses getAddresses() which returns structured object
      const addresses = await this.walletInstance.getAddresses();
      if (!addresses || typeof addresses !== 'object') return [];
      const out = [];
      for (const v of Object.values(addresses)) {
        if (v && typeof v === 'object' && typeof v.address === 'string' && v.address) out.push(v.address);
      }
      return [...new Set(out)];
    } catch (error) {
      debugWarn('Oyl: failed to get accounts');
      throw error;
    }
  }

  async getBalance() {
    this.requireConnected();

    try {
      // Check if Oyl supports getBalance
      if (typeof this.walletInstance.getBalance === 'function') {
        const balance = await this.walletInstance.getBalance();
        return normalizers.balance(balance, 'Oyl');
      }
      
      throw new Error('Oyl wallet does not support balance fetching');
    } catch (error) {
      throw new Error(`Failed to get Oyl balance: ${error.message}`);
    }
  }

  async getNetwork() {
    this.requireInstalled();

    try {
      if (typeof this.walletInstance.getNetwork === 'function') {
        const network = await this.walletInstance.getNetwork();
        return normalizers.network(network);
      }
      return 'livenet';
    } catch (error) {
      debugWarn('Oyl: failed to get network');
      return 'livenet';
    }
  }

  async switchNetwork(network) {
    this.requireInstalled();
    await this.walletInstance.switchNetwork(network);
    debugLog('Oyl network switched');
  }

  // ========================================
  // SIGNING METHODS
  // ========================================

  async signMessage(message, options = {}) {
    this.requireConnected();
    
    //  Important: OYL signMessage expects an object: { address, message, protocol? }
    const address = options.toSignAddress || this.paymentAddress || this.address;
    
    const response = await this.walletInstance.signMessage({
      address: address,
      message: message,
      protocol: options.protocol // 'bip322' | 'ecdsa'
    });
    
    // OYL returns { address: string, signature: string }
    return response?.signature || response;
  }

  async signPsbt(psbtHex, options = {}) {
    this.requireConnected();

    debugLog('OYL signPsbt called');

    try {
      // OYL API error message indicates it expects PSBT HEX for signing.
      // Normalize: if base64 provided, convert to hex; otherwise pass hex through.
      
      let psbtHexNormalized = psbtHex;
      
      // Handle Uint8Array input
      if (psbtHex instanceof Uint8Array) {
        debugLog('Converting PSBT from Uint8Array to HEX for OYL...');
        psbtHexNormalized = Array.from(psbtHex, byte => byte.toString(16).padStart(2, '0')).join('');
        debugLog('Converted Uint8Array to hex');
      }
      // Handle base64 string
      else if (typeof psbtHex === 'string' && psbtHex.startsWith('cHNidP')) {
        debugLog('Converting PSBT from BASE64 to HEX for OYL...');
        if (typeof Buffer !== 'undefined') {
          psbtHexNormalized = Buffer.from(psbtHex, 'base64').toString('hex');
        } else {
          const binary = atob(psbtHex);
          psbtHexNormalized = Array.from(binary, ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
        }
        debugLog('Converted base64 to hex');
      }
      // Validate it's actually hex
      else if (typeof psbtHex === 'string') {
        const cleaned = psbtHex.toLowerCase().trim();
        if (!/^[0-9a-f]+$/.test(cleaned)) {
          debugWarn('Invalid PSBT format - not hex, base64, or Uint8Array');
          throw new Error('Invalid PSBT format provided to OYL wallet');
        }
        psbtHexNormalized = cleaned;
        debugLog('Using provided hex');
      }
      
      // Verify PSBT magic bytes (70736274 = "psbt" in hex)
      if (!psbtHexNormalized.toLowerCase().startsWith('70736274')) {
        debugWarn('PSBT does not start with magic bytes (70736274)');
        throw new Error('Invalid PSBT: missing magic bytes');
      }

      debugLog('Calling OYL wallet.signPsbt...');
      debugLog('PSBT hex length:', psbtHexNormalized.length, 'chars');
      
      let result;
      
         try {
        // Build OYL-compatible options object
        const oylOptions = {
          psbt: psbtHexNormalized,
          finalize: options.autoFinalized ?? options.finalize ?? false,
          broadcast: options.broadcast ?? false
        };
        
        debugLog('OYL calling: signPsbt({ psbt, finalize, broadcast })');
        
        // OYL returns { psbt: string, txid?: string }
        result = await this.walletInstance.signPsbt(oylOptions);

        debugLog('OYL signed PSBT successfully');
        
      } catch (error) {
        debugWarn('OYL signPsbt failed:', error?.message);

        throw new Error(
          `OYL wallet failed to sign PSBT: ${error?.message}. ` +
          'Make sure you are connected to OYL wallet and try again.'
        );
      }
      
      // Extract the signed PSBT from OYL's response format
      // OYL returns { psbt: string, txid?: string }
      let signedPsbtHex = result?.psbt || result;
      
      if (!signedPsbtHex) {
        throw new Error('OYL returned invalid response - no psbt property found');
      }
      
      debugLog('OYL signed PSBT');
      
      // Normalize output to HEX if it came back as base64
      if (typeof signedPsbtHex === 'string' && signedPsbtHex.startsWith('cHNidP')) {
        debugLog('Converting signed PSBT from BASE64 back to HEX...');
        if (typeof Buffer !== 'undefined') {
          return Buffer.from(signedPsbtHex, 'base64').toString('hex');
        }
        const binary = atob(signedPsbtHex);
        return Array.from(binary, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      }
      
      return signedPsbtHex;
    } catch (error) {
      debugWarn('OYL signPsbt failed:', error?.message);
      throw error;
    }
  }

  async signPsbts(psbtHexs, options = {}) {
    this.requireConnected();

    debugLog('OYL signPsbts called with:', psbtHexs?.length, 'PSBTs');
    
    // Normalize all inputs to HEX
    const toHex = (psbt) => {
      if (typeof psbt !== 'string') return psbt;
      if (psbt.startsWith('cHNidP')) {
        // base64 -> hex
        if (typeof Buffer !== 'undefined') return Buffer.from(psbt, 'base64').toString('hex');
        const binary = atob(psbt);
        return Array.from(binary, ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      }
      return psbt; // assume already hex
    };

    const hexArray = (psbtHexs || []).map(toHex);
    
     const psbtsToSign = hexArray.map((psbtHex) => ({
      psbt: psbtHex,
      finalize: options.autoFinalized ?? options.finalize ?? false,
      broadcast: options.broadcast ?? false
    }));
    
    debugLog('OYL calling: signPsbts([{ psbt, finalize, broadcast }, ...])');
    
    // OYL returns [{ psbt: string, txid?: string }, ...]
    const results = await this.walletInstance.signPsbts(psbtsToSign);
    
    debugLog('OYL signed', results?.length, 'PSBTs');
    
    // Extract psbt strings from result objects and normalize to HEX
    if (Array.isArray(results)) {
      return results.map((result) => {
        const psbtStr = result?.psbt || result;
        
        // Convert base64 to hex if needed
        if (typeof psbtStr === 'string' && psbtStr.startsWith('cHNidP')) {
          if (typeof Buffer !== 'undefined') return Buffer.from(psbtStr, 'base64').toString('hex');
          const bin = atob(psbtStr);
          return Array.from(bin, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
        }
        return psbtStr;
      });
    }
    return results;
  }

  async pushPsbt(psbtHex) {
    this.requireConnected();

    const response = await this.walletInstance.pushPsbt({ psbt: psbtHex });
    
    // OYL returns { txid: string }
    const txid = response?.txid || response;
    debugLog('Oyl PSBT pushed');
    return txid;
  }

  // ========================================
  // TRANSACTION METHODS
  // ========================================

  async sendBitcoin(toAddress, amount) {
    this.requireConnected();
    BaseWalletProvider.validateSendParams(toAddress, amount);

    // Check if Oyl actually supports this
    if (typeof this.walletInstance.sendBitcoin !== 'function') {
      debugWarn('Oyl wallet may not support sendBitcoin directly');
      throw new Error(
        'Oyl wallet does not support sendBitcoin() method.\n' +
        'Use sendToRelayProvider() or external transaction building.'
      );
    }
    
    try {
      const txid = await this.walletInstance.sendBitcoin(toAddress, amount);
      debugLog('Oyl transaction sent');
      return txid;
    } catch (error) {
      debugWarn('Oyl: failed to send Bitcoin');
      throw error;
    }
  }

  // ========================================
  // INSCRIPTION METHODS
  // ========================================

  async getInscriptions(offset = 0, limit = 100) {
    this.requireConnected();

    try {
      // Check if Oyl supports getInscriptions
      if (typeof this.walletInstance.getInscriptions !== 'function') {
        debugWarn('Oyl wallet does not support inscription fetching');
        return { list: [], total: 0 };
      }
      
      const response = await this.walletInstance.getInscriptions(offset, limit);
      
      // Handle both array and object responses
      const inscriptions = Array.isArray(response) ? response : (response.list || []);
      
      return {
        list: inscriptions.map(i => normalizers.inscription(i, 'Oyl')),
        total: inscriptions.length
      };
    } catch (error) {
      debugWarn('Failed to fetch Oyl inscriptions');
      return { list: [], total: 0 };
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  async sendToRelayProvider(data) {
    this.requireInstalled();
    
    if (typeof this.walletInstance.sendToRelayProvider !== 'function') {
      throw new Error('Oyl wallet does not support sendToRelayProvider()');
    }
    
    return await this.walletInstance.sendToRelayProvider(data);
  }
}

export default OylProvider;
