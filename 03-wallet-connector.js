/**
 * WalletConnector - Generic Connection Module
 *
 * NOTE: We intentionally do NOT depend on the `sats-connect` NPM package here.
 * Instead, we implement a lightweight, sats-connect-compatible request layer
 * by calling the injected wallet provider's `request()` / `connect()` methods
 * using the same method names and payload shapes that sats-connect documents.
 */

// ============= CONSTANTS =============

export const AddressPurpose = {
  Payment: 'payment',
  Ordinals: 'ordinals',
  Stacks: 'stacks'
};

export const BitcoinNetworkType = {
  Mainnet: 'Mainnet',
  Testnet: 'Testnet'
};

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugLog = (...args) => {
  if (__nexusWalletDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
};

async function requestCompat(provider, method, params) {
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('Wallet provider missing request()');
  }

  const toMsg = (e) => {
    try {
      if (!e) return '';
      if (typeof e === 'string') return e;
      if (e?.message) return String(e.message);
      if (e?.error?.message) return String(e.error.message);
      if (e?.error) return String(e.error);
      return JSON.stringify(e);
    } catch {
      try { return String(e); } catch { return ''; }
    }
  };

  const tryTwoArg = async () => {
    if (params === undefined) return await provider.request(method);
    return await provider.request(method, params);
  };

  let firstError = null;
  try {
    return await tryTwoArg();
  } catch (e) {
    firstError = e;
  }

  // EIP-1193 style request({ method, params })
  try {
    const payload = params === undefined ? { method } : { method, params };
    return await provider.request(payload);
  } catch (e2) {
    const msg = `Wallet request failed (method=${String(method)}): ${toMsg(e2) || toMsg(firstError) || 'Unknown error'}`;
    const out = new Error(msg);
    out.cause = e2 || firstError;
    throw out;
  }
}

// ============= HELPER FUNCTIONS =============

/**
 * Extract actual provider object from btc_providers entry
 * Different wallets structure their entries differently
 */
function extractProviderFromEntry(entry) {
  if (!entry) return null;
  
  // Direct request method on entry
  if (typeof entry.request === 'function') {
    return entry;
  }
  
  // Provider in nested property
  if (entry.provider && typeof entry.provider.request === 'function') {
    return entry.provider;
  }
  
  // Wallet connector namespace (Xverse uses this)
  const ns = 'sats-connect:';
  if (entry.features?.[ns]?.provider) {
    const provider = entry.features[ns].provider;
    if (typeof provider.request === 'function') {
      return provider;
    }
  }
  
  return null;
}

/**
 * Create unsecured JWT token for Bitcoin wallet API requests.
 * Used by: Magic Eden, Xverse, and other wallets that follow sats-connect pattern.
 * Format: {typ: 'JWT', alg: 'none'}.{payload}.
 * 
 * ⚠️ SECURITY WARNING: This creates an UNSIGNED token (alg: 'none') intended ONLY
 * for local wallet-provider communication via the sats-connect protocol.
 * These tokens carry NO authentication guarantee and MUST NOT be treated as
 * proof of identity, authorization, or data integrity by any server or service.
 * A malicious caller can craft arbitrary payloads. Never trust these tokens
 * for anything beyond wallet API parameter passing.
 * 
 * @param {Object} payload - The payload to encode in the token
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.includeIat=false] - Include issued-at timestamp to limit replay window
 * @returns {string} JWT token string (unsigned, base64url encoded)
 */
export function createUnsecuredToken(payload, options = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('createUnsecuredToken: payload must be a non-null object');
  }

  const header = { typ: 'JWT', alg: 'none' };
  
  // Optionally include iat (issued-at) to limit replay windows
  const finalPayload = options.includeIat
    ? { iat: Math.floor(Date.now() / 1000), ...payload }
    : payload;
  
  const base64url = (str) => {
    return btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };
  
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(finalPayload))}.`;
}

/**
 * @deprecated Use createUnsecuredToken instead
 * Kept for backwards compatibility
 */
export function createMagicEdenToken(payload) {
  return createUnsecuredToken(payload);
}

// ============= GET PROVIDER =============

/**
 * Get Bitcoin provider from various possible locations
 * Checks multiple injection points to find the active wallet
 * @returns {Object|null}
 */
export function getBitcoinProvider() {
  if (typeof window === 'undefined') return null;
  
  // Priority 1: Check btc_providers array (Xverse, Leather register here)
  if (window.btc_providers && Array.isArray(window.btc_providers) && window.btc_providers.length > 0) {
    // Try each provider in order (most recent wins)
    for (const entry of window.btc_providers) {
      const provider = extractProviderFromEntry(entry);
      if (provider) {
        debugLog(`✅ Found Bitcoin provider: ${entry.name || entry.id}`);
        return provider;
      }
    }
  }
  
  // Priority 2: Check Magic Eden (uses direct connect(), not in btc_providers)
  if (window.magicEden?.bitcoin?.isMagicEden) {
    debugLog('✅ Using window.magicEden.bitcoin (Magic Eden)');
    return window.magicEden.bitcoin;
  }

  // Priority 2.5: Check BitmapWallet inpage provider
  if (window.bitmapWallet && typeof window.bitmapWallet.request === 'function') {
    debugLog('✅ Using window.bitmapWallet (BitmapWallet)');
    return window.bitmapWallet;
  }
  
  // Priority 3: Direct window.BitcoinProvider (fallback)
  if (window.BitcoinProvider && typeof window.BitcoinProvider.request === 'function') {
    debugLog('✅ Using window.BitcoinProvider');
    return window.BitcoinProvider;
  }
  
  // Priority 4: Xverse-specific location (legacy)
  if (window.XverseProviders?.BitcoinProvider) {
    debugLog('✅ Using window.XverseProviders.BitcoinProvider');
    return window.XverseProviders.BitcoinProvider;
  }
  
  // eslint-disable-next-line no-console
  console.warn('❌ No Bitcoin wallet provider found');
  return null;
}

// ============= ADDRESS METHODS =============

/**
 * Get addresses from wallet
 * @param {Object} options
 * @param {Array<string>} options.purposes - Array of address purposes
 * @param {string} [options.message] - Message to display
 * @returns {Promise<Array>} Array of addresses
 */
export async function getAddresses({ purposes, message, network } = {}) {
  const provider = getBitcoinProvider();
  
  if (!provider) {
    throw new Error('No Bitcoin wallet found. Install Xverse, Leather, or Magic Eden.');
  }
  
  // Check if this is Magic Eden (uses direct connect() with JWT)
  if (window.magicEden?.bitcoin && provider === window.magicEden.bitcoin) {
    debugLog('🔍 Using Magic Eden direct connect()...');
    return await connectMagicEden(purposes, message);
  }
  
  // For all other wallets, try multiple method names (different wallets use different ones)
  const methodNames = ['wallet_connect', 'getAddresses'];
  let lastError = null;
  
  for (const methodName of methodNames) {
    try {
      debugLog(`🔍 Trying ${methodName}...`);

      const params = {
        purposes: purposes || [AddressPurpose.Payment, AddressPurpose.Ordinals],
        message: message || 'Connect to view your Bitcoin addresses'
      };
      if (network) {
        params.network = network;
      }

      const response = await requestCompat(provider, methodName, params);
      
      // Handle different response formats
      if (response?.status === 'success') {
        return response.result.addresses || response.result;
      } else if (response?.status === 'error') {
        throw new Error(response.error?.message || 'Failed to get addresses');
      } else if (response?.result?.addresses) {
        return response.result.addresses;
      } else if (response?.addresses) {
        return response.addresses;
      } else if (Array.isArray(response)) {
        return response;
      }
      
      // If we got a response but it's not in expected format, try next method
      debugWarn(`⚠️ ${methodName} returned unexpected format, trying next method...`);
      lastError = new Error(`${methodName} returned unexpected format`);
      
    } catch (error) {
      debugWarn(`⚠️ ${methodName} failed:`, error?.message || String(error));
      lastError = error;
      // Try next method
    }
  }
  
  // All methods failed
  throw lastError || new Error('Failed to get addresses from wallet');
}

/**
 * Helper: Connect to Magic Eden using direct connect() method with JWT token
 */
async function connectMagicEden(purposes, message) {
  const provider = window.magicEden.bitcoin;
  
  // Create JWT token (Magic Eden requires this format)
  const payload = {
    purposes: purposes || ['payment', 'ordinals'],
    message: message || 'Connect to view your Bitcoin addresses',
    network: { type: 'Mainnet' }
  };
  
  const token = createUnsecuredToken(payload);

  debugLog('🔍 Calling Magic Eden connect() with JWT token...');
  const response = await provider.connect(token);
  
  // Magic Eden returns {addresses: [...]}
  if (response?.addresses && Array.isArray(response.addresses)) {
    return response.addresses;
  }
  
  throw new Error('Invalid response from Magic Eden');
}

// ============= SIGNING =============

/**
 * Sign a message
 * @param {Object} options
 * @param {string} options.address - Address to sign with
 * @param {string} options.message - Message to sign
 * @param {string} [options.protocol] - 'BIP322' or 'ECDSA'
 * @returns {Promise<string>} Signature
 */
export async function signMessage({ address, message, protocol = 'BIP322' }) {
  const provider = getBitcoinProvider();
  
  if (!provider) {
    throw new Error('No Bitcoin wallet found');
  }
  
  const response = await requestCompat(provider, 'signMessage', {
    address,
    message,
    protocol
  });
  
  if (response.status === 'success') {
    return response.result.signature || response.result;
  } else if (response.status === 'error') {
    throw new Error(response.error?.message || 'Failed to sign message');
  }
  
  return response;
}

/**
 * Sign PSBT
 * @param {Object} options
 * @param {string} options.psbtBase64 - Base64 PSBT
 * @param {Array} options.inputsToSign - Inputs to sign
 * @param {boolean} [options.broadcast] - Broadcast after signing
 * @returns {Promise<Object>} Signed PSBT
 */
export async function signPsbt({ psbtBase64, inputsToSign, broadcast = false }) {
  const provider = getBitcoinProvider();
  
  if (!provider) {
    throw new Error('No Bitcoin wallet found');
  }
  
  const response = await requestCompat(provider, 'signPsbt', {
    psbt: {
      psbtBase64,
      inputsToSign,
      broadcast
    }
  });
  
  if (response.status === 'success') {
    return {
      psbtBase64: response.result.psbtBase64 || response.result,
      txid: response.result.txid
    };
  } else if (response.status === 'error') {
    throw new Error(response.error?.message || 'Failed to sign PSBT');
  }
  
  return response;
}

// ============= TRANSFERS =============

/**
 * Send Bitcoin
 * @param {Object} options
 * @param {Array} options.recipients - Recipients array
 * @returns {Promise<string>} Transaction ID
 */
export async function sendTransfer({ recipients }) {
  const provider = getBitcoinProvider();
  
  if (!provider) {
    throw new Error('No Bitcoin wallet found');
  }
  
  const response = await requestCompat(provider, 'sendTransfer', { recipients });
  
  if (response.status === 'success') {
    return response.result.txid || response.result;
  } else if (response.status === 'error') {
    throw new Error(response.error?.message || 'Failed to send transfer');
  }
  
  return response;
}

// ============= INSCRIPTIONS =============

/**
 * Get inscriptions
 * @param {Object} options
 * @param {number} [options.offset]
 * @param {number} [options.limit]
 * @returns {Promise<Array>} Inscriptions
 */
export async function getInscriptions({ offset = 0, limit = 100 }) {
  const provider = getBitcoinProvider();
  
  if (!provider) {
    throw new Error('No Bitcoin wallet found');
  }
  
  try {
    const response = await requestCompat(provider, 'ord_getInscriptions', {
      offset,
      limit
    });
    
    if (response.status === 'success') {
      return response.result.inscriptions || response.result.list || response.result || [];
    }
  } catch (error) {
    debugWarn('Inscriptions not supported:', error?.message || String(error));
    return [];
  }
  
  return [];
}

// ============= BALANCE =============

/**
 * Get balance from wallet
 * @param {Object} [options] - Options (currently unused as sats-connect auto-uses payment address)
 * @returns {Promise<{confirmed: string, unconfirmed: string, total: string}>} Balance in satoshis
 */
export async function getBalance(options = {}) {
  const provider = getBitcoinProvider();
  
  if (!provider) {
    throw new Error('No Bitcoin wallet found');
  }
  
  try {
    // Use getBalance method via sats-connect request pattern
    // According to sats-connect spec: request('getBalance', undefined)
    // The wallet automatically returns balance for the connected payment address
    const response = await requestCompat(provider, 'getBalance', undefined);
    
    // Handle both JSON-RPC 2.0 format and sats-connect format
    if (response && response.jsonrpc === '2.0' && response.result) {
      // JSON-RPC 2.0 format: { jsonrpc: "2.0", result: { confirmed, unconfirmed, total }, id }
      return response.result;
    } else if (response.status === 'success') {
      // sats-connect format: { status: "success", result: { confirmed, unconfirmed, total } }
      return response.result;
    } else if (response.status === 'error') {
      throw new Error(response.error?.message || 'Failed to get balance');
    }
    
    return response;
  } catch (error) {
    debugWarn('getBalance not supported:', error?.message || String(error));
    throw error;
  }
}

// ============= EXPORTS =============

export default {
  AddressPurpose,
  BitcoinNetworkType,
  getBitcoinProvider,
  getAddresses,
  signMessage,
  signPsbt,
  sendTransfer,
  getInscriptions,
  getBalance,
  createUnsecuredToken,
  createMagicEdenToken // deprecated alias
};
