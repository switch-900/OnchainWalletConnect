/**
 * Leather Wallet Provider 
 */

// Import from ordinal inscriptions (update sat numbers after inscribing)
import { normalizePsbtFormat } from './02-normalizers.js';
import { BaseWalletProvider } from './01-base-provider.js';

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugLog = (...args) => {
  if (__nexusWalletDebugEnabled()) console.log(...args);
};

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) console.warn(...args);
};


export class LeatherProvider extends BaseWalletProvider {
  constructor() {
    super('Leather');
    
    this.walletInstance = this.getProvider();
    
    // Feature flags - Leather capabilities (TESTED from diagnostic)
    // Leather is a Stacks wallet with Bitcoin support using Stacks-specific methods
    this.features = {
      connect: true,                    // ✅ Via request('getAddresses')
      getAddress: true,                 // ✅ Via request('getAddresses')
      getPublicKey: false,              // ❌ Not available
      getBalance: false,                // ❌ Not available
      getNetwork: false,                // ❌ Not available
      switchNetwork: false,             // ❌ Not available
      signMessage: true,                // ✅ Via signatureRequest() (NOT signMessage!)
      signPsbt: true,                   // ✅ Via psbtRequest() (NOT signPsbt!)
      signPsbts: false,                 // ❌ No batch signing
      pushPsbt: false,                  // ❌ Not available
      pushTx: false,                    // ❌ Not available
      sendBitcoin: false,               // ❌ Not available
      sendInscription: false,           // ❌ Not available
      getInscriptions: false,           // ❌ Not available
      getAllInscriptions: false,        // ❌ Not available
      inscribe: false,                  // ❌ Not available
      brc20: false,                     // ❌ No BRC-20
      runes: false,                     // ❌ No Runes
      atomicals: false,                 // ❌ No Atomicals
      arc20: false,                     // ❌ No ARC-20
      stacksSupport: true,              // ✅ Full Stacks blockchain support
      structuredData: true,             // ✅ structuredDataSignatureRequest()
      authentication: true,             // ✅ authenticationRequest()
      stacksTransaction: true,          // ✅ transactionRequest()
      profileUpdate: true,              // ✅ profileUpdateRequest()
      getProductInfo: true,             // ✅ getProductInfo()
      getURL: true                      // ✅ getURL()
    };
  }

  getProvider() {
    if (typeof window === 'undefined') return null;
    
    // Leather provides the actual API at window.LeatherProvider
    // The btc_providers array only contains metadata/registration info
    if (window.LeatherProvider) {
      debugLog('🔍 Found Leather at window.LeatherProvider');
      return window.LeatherProvider;
    }
    
    // Fallback to Hiro name (old name for Leather)
    if (window.HiroWalletProvider) {
      debugLog('🔍 Found Hiro Wallet at window.HiroWalletProvider');
      return window.HiroWalletProvider;
    }
    
    // Last resort: check btc_providers array
    // (Note: this usually contains metadata, not the actual provider)
    if (window.btc_providers && Array.isArray(window.btc_providers)) {
      for (const entry of window.btc_providers) {
        if (entry.id === 'LeatherProvider' || entry.name === 'Leather') {
          // Only use if it has the request method (actual provider, not just metadata)
          if (typeof entry.request === 'function') {
            debugLog('🔍 Found Leather provider in btc_providers');
            return entry;
          }
        }
      }
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

    try {
      const provider = this.getProvider();
      
      if (!provider || typeof provider.request !== 'function') {
        throw new Error('Leather provider.request method not available');
      }

      debugLog('🔍 Calling Leather provider.request("getAddresses")...');
      const response = await provider.request('getAddresses');

      // Handle nested response structure
      const addresses = response.result?.addresses || response.addresses;
      
      if (!addresses || addresses.length === 0) {
        throw new Error('No addresses returned from Leather');
      }

      // 🎯 PRIORITY: Try Taproot (p2tr) first for lower fees, fallback to SegWit (p2wpkh)
      // Leather may provide multiple address types - prefer Taproot if available
      debugLog('🔍 Available address types from Leather:', addresses.map(a => a.type));
      
      const taprootAddress = addresses.find(addr => addr.type === 'p2tr');
      const segwitAddress = addresses.find(addr => addr.type === 'p2wpkh');
      
      // 🎯 CRITICAL: Use Taproot for ordinals (lower fees), SegWit for payments
      // This gives us TWO addresses for proper UTXO separation
      const ordinalsAddr = taprootAddress || segwitAddress || addresses[0];
      const paymentAddr = segwitAddress || taprootAddress || addresses[0];
      
      if (taprootAddress && segwitAddress) {
        debugLog('✅ Using Taproot (ordinals) + SegWit (payments) for optimal setup');
      } else if (taprootAddress) {
        debugLog('ℹ️ Using Taproot for both addresses (SegWit not available)');
      } else if (segwitAddress) {
        debugLog('ℹ️ Using SegWit for both addresses (Taproot not available)');
      } else {
        debugWarn('⚠️ Unknown address type, using first available');
      }
      
      // Set primary address to ordinals address
      this.address = ordinalsAddr?.address;
      this.ordinalsAddress = ordinalsAddr?.address;
      this.paymentAddress = paymentAddr?.address;
      this.isConnected = true;

      debugLog('✅ Leather connected');
      
      return { 
        address: this.address,
        ordinalsAddress: this.ordinalsAddress,
        paymentAddress: this.paymentAddress,
        allAddresses: addresses 
      };
    } catch (error) {
      debugWarn('❌ Leather connection failed');
      throw error;
    }
  }

  async getAddress() {
    this.requireConnected();
    return this.address;
  }

  async getAccounts() {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      const response = await provider.request('getAddresses');

      // Handle nested response structure
      return response.result?.addresses || response.addresses;
    } catch (error) {
      debugWarn('❌ Failed to get accounts');
      throw error;
    }
  }

  // ========================================
  // LEATHER-SPECIFIC METHODS (Stacks API)
  // ========================================

  /**
   * Get Leather wallet product info
   * Uses Leather's getProductInfo() method
   * @returns {Promise<Object>} Product information
   */
  async getProductInfo() {
    this.requireInstalled();

    try {
      const provider = this.getProvider();
      const info = await provider.getProductInfo();
      debugLog('✅ Leather product info received');
      return info;
    } catch (error) {
      debugWarn('❌ Failed to get product info');
      throw error;
    }
  }

  /**
   * Get Leather wallet URL
   * Uses Leather's getURL() method
   * @returns {Promise<string>} Wallet URL
   */
  async getURL() {
    this.requireInstalled();

    try {
      const provider = this.getProvider();
      const url = await provider.getURL();
      return url;
    } catch (error) {
      debugWarn('❌ Failed to get URL');
      throw error;
    }
  }

  // ========================================
  // SIGNING METHODS (Stacks-specific)
  // ========================================

  /**
   * Sign a message using Leather's signatureRequest (NOT signMessage!)
   * Docs: https://leather.gitbook.io/developers/bitcoin/sign-messages
   * @param {string} message - Message to sign
   * @param {Object} options - Signing options
   * @returns {Promise<Object>} Signature response
   */
  async signMessage(message, options = {}) {
    this.requireConnected();

    try {
      const provider = this.getProvider();

      debugLog('🔏 Leather: Signing message via signatureRequest...');
      
      // Use Leather's actual method: signatureRequest (NOT signMessage!)
      const response = await provider.signatureRequest({
        message,
        ...options
      });

      debugLog('✅ Leather message signed');
      return response;
    } catch (error) {
      debugWarn('❌ Failed to sign message');
      throw error;
    }
  }

  /**
   * Sign structured data using Leather's structuredDataSignatureRequest
   * @param {Object} structuredData - Structured data to sign
   * @returns {Promise<Object>} Signature response
   */
  async signStructuredData(structuredData) {
    this.requireConnected();

    try {
      const provider = this.getProvider();

      debugLog('🔏 Leather: Signing structured data...');
      const response = await provider.structuredDataSignatureRequest(structuredData);

      debugLog('✅ Leather structured data signed');
      return response;
    } catch (error) {
      debugWarn('❌ Failed to sign structured data');
      throw error;
    }
  }

  /**
   * Sign a PSBT using Leather's psbtRequest (NOT signPsbt!)
   * Docs: https://leather.gitbook.io/developers/bitcoin/sign-transactions
   * @param {string} psbtHex - PSBT in hex format
   * @param {Object} options - Signing options
   * @returns {Promise<Object>} Signed PSBT response
   */
    async signPsbt(psbtHex, options = {}) {
    this.requireConnected();

    if (!psbtHex || typeof psbtHex !== 'string') {
      throw new Error('Invalid PSBT: must be a non-empty string');
    }

    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Leather provider not available');
      }

      debugLog('🔏 Leather: Preparing PSBT for signing...');
      debugLog('   Testing both HEX and BASE64 formats...');

      // Map generic options to Leather-specific fields
      // Leather expects `signAtIndex: number[]` OR per-input sighash configuration
      const toSignInputs = options?.toSignInputs || options?.inputsToSign || [];
      
      const signAtIndex = Array.isArray(toSignInputs)
        ? toSignInputs
            .map(x => (typeof x?.index === 'number' ? x.index : null))
            .filter(i => i !== null)
        : undefined;

      // Extract per-input sighash types if specified (needed for SINGLE|ANYONECANPAY)
      const inputSighashMap = {};
      if (Array.isArray(toSignInputs)) {
        toSignInputs.forEach(input => {
          if (typeof input?.index === 'number') {
            // Check for explicit sighashType (singular, preferred)
            if (typeof input.sighashType === 'number') {
              inputSighashMap[input.index] = input.sighashType;
            }
            // Fallback: check sighashTypes array (take first non-DEFAULT)
            else if (Array.isArray(input.sighashTypes) && input.sighashTypes.length > 0) {
              const nonDefault = input.sighashTypes.find(t => t !== 0 && t !== 0x00);
              if (nonDefault) {
                inputSighashMap[input.index] = nonDefault;
              }
            }
          }
        });
      }

      // Build a minimal, Leather-friendly request object
      const buildRequest = (hexOrBase64, usePsbtParam = false) => {
        const req = usePsbtParam
          ? { psbt: hexOrBase64 }
          : { hex: hexOrBase64 };
        if (typeof options?.broadcast === 'boolean') req.broadcast = !!options.broadcast;
        if (options?.network) req.network = options.network;
        if (signAtIndex && signAtIndex.length > 0) req.signAtIndex = signAtIndex;
        // 🔧 CRITICAL: Pass per-input sighash types to Leather for SINGLE|ANYONECANPAY support
        if (Object.keys(inputSighashMap).length > 0) {
          req.inputSighashMap = inputSighashMap;
          debugLog('   🔍 Passing sighash types to Leather');
        }
        return req;
      };

      // Test 1: Try with hex first (what the parameter name suggests)
      try {
        debugLog('   Attempt 1: Sending HEX format');
        const response = await provider.request('signPsbt', buildRequest(psbtHex));
        debugLog('✅ HEX format worked');
        const signedPsbt = response?.result?.hex || response?.hex || response?.psbt || response;
        return signedPsbt;
      } catch (hexError) {
        debugWarn('❌ HEX format failed');
      }

      // Test 2: Try with base64 (for JWT safety)
      try {
        debugLog('   Attempt 2: Sending BASE64 in hex parameter');
        const psbtBase64 = normalizePsbtFormat(psbtHex, 'Leather', 'input');
        const response = await provider.request('signPsbt', buildRequest(psbtBase64));
        debugLog('✅ BASE64 in hex parameter worked');
        const signedPsbt = response?.result?.hex || response?.hex || response?.psbt || response;
        // Convert back from base64 to hex if needed
        if (/^[A-Za-z0-9+/]+=*$/.test(signedPsbt)) {
          return normalizePsbtFormat(signedPsbt, 'Leather', 'output');
        }
        return signedPsbt;
      } catch (base64Error) {
        debugWarn('❌ BASE64 format failed');
      }

      // Test 3: Try with psbt parameter (not hex)
      try {
        debugLog('   Attempt 3: Sending BASE64 in psbt parameter');
        const psbtBase64 = normalizePsbtFormat(psbtHex, 'Leather', 'input');
        const response = await provider.request('signPsbt', buildRequest(psbtBase64, true));
        debugLog('✅ psbt parameter worked');
        const signedPsbt = response?.result?.hex || response?.hex || response?.psbt || response;
        if (/^[A-Za-z0-9+/]+=*$/.test(signedPsbt)) {
          return normalizePsbtFormat(signedPsbt, 'Leather', 'output');
        }
        return signedPsbt;
      } catch (psbtError) {
        debugWarn('❌ psbt parameter failed');
        throw new Error('All PSBT format attempts failed.');
      }
      
    } catch (error) {
      debugWarn('❌ Leather PSBT signing failed');
      debugWarn('   Error message:', error?.message);
      
      const errorMessage = error?.message || error?.toString() || 'Unknown Leather signing error';
      
      // Check for user rejection
      if (errorMessage.includes('User rejected') || errorMessage.includes('cancelled')) {
        throw new Error('User rejected the signing request');
      }
      
      throw new Error(`Leather signing failed: ${errorMessage}`);
    }
  }

  // ========================================
  // STACKS BLOCKCHAIN METHODS
  // ========================================

  /**
   * Authenticate user with Leather
   * Uses Leather's authenticationRequest method
   * @param {Object} authOptions - Authentication options
   * @returns {Promise<Object>} Authentication response
   */
  async authenticate(authOptions = {}) {
    this.requireInstalled();

    try {
      const provider = this.getProvider();

      debugLog('🔏 Leather: Requesting authentication...');
      const response = await provider.authenticationRequest(authOptions);

      debugLog('✅ Leather authentication complete');
      return response;
    } catch (error) {
      debugWarn('❌ Authentication failed');
      throw error;
    }
  }

  /**
   * Send a Stacks transaction
   * Uses Leather's transactionRequest method
   * @param {Object} txOptions - Transaction options
   * @returns {Promise<Object>} Transaction response
   */
  async sendStacksTransaction(txOptions) {
    this.requireConnected();

    try {
      const provider = this.getProvider();

      debugLog('🔏 Leather: Sending Stacks transaction...');
      const response = await provider.transactionRequest(txOptions);

      debugLog('✅ Stacks transaction sent');
      return response;
    } catch (error) {
      debugWarn('❌ Stacks transaction failed');
      throw error;
    }
  }

  /**
   * Update user profile
   * Uses Leather's profileUpdateRequest method
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Profile update response
   */
  async updateProfile(profileData) {
    this.requireConnected();

    try {
      const provider = this.getProvider();

      debugLog('🔏 Leather: Updating profile...');
      const response = await provider.profileUpdateRequest(profileData);

      debugLog('✅ Profile updated');
      return response;
    } catch (error) {
      debugWarn('❌ Profile update failed');
      throw error;
    }
  }

  // Note: Methods like sendBitcoin, getInscriptions, getBalance are NOT supported by Leather
  // Leather is primarily a Stacks wallet with Bitcoin signing capabilities
  // Use external APIs for balance and inscription data
}

export default LeatherProvider;
