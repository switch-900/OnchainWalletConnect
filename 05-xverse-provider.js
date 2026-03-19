/**
 * Xverse Wallet Provider
 */

// Import from ordinal inscriptions (update sat numbers after inscribing)
import { BaseWalletProvider } from './01-base-provider.js';
import { createUnsecuredToken } from './03-wallet-connector.js';
import { normalizePsbtFormat } from './02-normalizers.js';

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

// Shadow console in this module so existing debug logs become opt-in.
// This file had extensive logging of addresses/pubkeys/PSBT details.
const console = {
  log: debugLog,
  info: debugLog,
  debug: debugLog,
  warn: debugWarn,
  error: debugError
};

function _parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s) return value;
  if (!(s.startsWith('{') || s.startsWith('['))) return value;
  try {
    return JSON.parse(s);
  } catch {
    return value;
  }
}

async function _requestCompat(provider, method, params) {
  if (!provider) throw new Error('Xverse provider not available');
  if (typeof provider.request !== 'function') {
    throw new Error('Xverse provider does not support request()');
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
    const res = await tryTwoArg();
    if (res !== undefined && res !== null) return res;
  } catch (e) {
    firstError = e;
  }

  // Some sats-connect / EIP-1193 providers implement request({ method, params }).
  try {
    const payload = params === undefined ? { method } : { method, params };
    const res = await provider.request(payload);
    if (res !== undefined && res !== null) return res;
  } catch (e2) {
    const m1 = toMsg(firstError);
    const m2 = toMsg(e2);
    const msg = `Xverse request failed (method=${String(method)}): ${m2 || m1 || 'Unknown error'}`;
    const out = new Error(msg);
    out.cause = e2 || firstError;
    throw out;
  }

  if (firstError) {
    const msg = `Xverse request returned empty result (method=${String(method)}): ${toMsg(firstError) || 'Unknown error'}`;
    const out = new Error(msg);
    out.cause = firstError;
    throw out;
  }
  throw new Error(`Xverse request returned empty result (method=${String(method)})`);
}

function _asError(err, prefix) {
  if (err instanceof Error) {
    if (prefix && !String(err.message || '').startsWith(prefix)) {
      const out = new Error(`${prefix}: ${err.message || String(err)}`);
      out.cause = err;
      return out;
    }
    return err;
  }
  let msg = '';
  try {
    if (typeof err === 'string') msg = err;
    else if (err?.message) msg = String(err.message);
    else msg = JSON.stringify(err);
  } catch {
    msg = String(err);
  }
  const out = new Error(prefix ? `${prefix}: ${msg}` : msg || 'Unknown error');
  out.cause = err;
  return out;
}

function _coerceAddressesFromResponse(response) {
  const r0 = _parseMaybeJson(response);

  // common shapes in the wild:
  // - { status:'success', result:{ addresses:[...] } }
  // - { jsonrpc:'2.0', result:{ addresses:[...] } }
  // - { result:{ data:{ addresses:[...] } } }
  // - { addresses:[...] }
  // - [...] (array)
  const candidates = [
    r0?.result?.addresses,
    r0?.result?.data?.addresses,
    r0?.result?.payload?.addresses,
    r0?.payload?.addresses,
    r0?.data?.addresses,
    r0?.addresses,
    (r0?.jsonrpc === '2.0' ? r0?.result?.addresses : null),
    (r0?.jsonrpc === '2.0' && Array.isArray(r0?.result) ? r0.result : null),
    (Array.isArray(r0?.result) ? r0.result : null),
    (Array.isArray(r0) ? r0 : null)
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const vals = Object.values(c);
      if (vals.length && vals.every(v => v && typeof v === 'object')) return vals;
    }
  }

  // Some providers return an empty array until the user approves; keep the empty array distinct.
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const vals = Object.values(c);
      if (vals.every(v => v && typeof v === 'object')) return vals;
    }
  }
  return null;
}

function _addrLooksTaproot(addr) {
  const a = String(addr || '').toLowerCase();
  return a.startsWith('bc1p') || a.startsWith('tb1p') || a.startsWith('bcrt1p');
}

function _addrLooksSegwit(addr) {
  const a = String(addr || '').toLowerCase();
  return a.startsWith('bc1q') || a.startsWith('tb1q') || a.startsWith('bcrt1q');
}

function _purposeLower(acc) {
  return String(
    acc?.purpose ??
      acc?.addressPurpose ??
      acc?.type ??
      acc?.addressType ??
      ''
  ).toLowerCase();
}

const getInjectedXverseProvider = () => {
  try {
    if (typeof window === 'undefined') return null;

    // 1) Direct injection locations (legacy and common)
    const direct = window.XverseProviders?.BitcoinProvider || window.BitcoinProvider;
    if (direct && typeof direct.request === 'function') return direct;

    // 2) btc_providers registry (common for sats-connect wallets)
    const list = window.btc_providers;
    if (Array.isArray(list)) {
      for (const entry of list) {
        const label = String(entry?.name || entry?.id || '').toLowerCase();
        if (!label.includes('xverse')) continue;

        const provider =
          (typeof entry?.request === 'function' ? entry : null) ||
          (entry?.provider && typeof entry.provider.request === 'function' ? entry.provider : null) ||
          (entry?.features?.['sats-connect:']?.provider && typeof entry.features['sats-connect:'].provider.request === 'function'
            ? entry.features['sats-connect:'].provider
            : null);
        if (provider) return provider;
      }
    }

    return null;
  } catch {
    return null;
  }
};

export class XverseProvider extends BaseWalletProvider {
  constructor() {
    super('Xverse');
    this.paymentAddress = null;
    this.ordinalsAddress = null;
    this.paymentPublicKey = null;
    this.ordinalsPublicKey = null;
    
    // Set walletInstance directly (can't call this.getProvider() in constructor)
    if (typeof window !== 'undefined') {
      const candidate = getInjectedXverseProvider();
      if (candidate) this.walletInstance = candidate;
    }
    
    // Feature flags - Xverse capabilities (TESTED & CONFIRMED)
    // All features accessed via provider.request() method
    // Docs: https://docs.xverse.app/sats-connect/bitcoin-methods
    this.features = {
      connect: true,                    // wallet_connect via request()
      getAddress: true,                 // getAddresses via request()
      getPublicKey: true,               // From wallet_connect response
      getBalance: true,                 //  CONFIRMED: request('getBalance')
      signMessage: true,                // signMessage via request()
      signPsbt: true,                   //  signPsbt() wrapper for signTransaction
      signPsbts: true,                  //  signPsbts() wrap  per for signMultipleTransactions
      pushPsbt: false,                  //  No broadcast methods (use extension/proxy)
      pushTx: false,                    //  No broadcast methods (use extension/proxy)
      signTransaction: true,            // signTransaction (Xverse name for signPsbt)
      signMultipleTransactions: true,   // signMultipleTransactions
      sendBtcTransaction: true,         // sendTransfer via request()
      getInscriptions: true,            //  CONFIRMED: request('ord_getInscriptions')
      sendInscription: true,            // ord_sendInscriptions via request()
      createInscription: true,          //  CONFIRMED: createInscription()
      createRepeatInscriptions: true,   //  CONFIRMED: createRepeatInscriptions()
      getUtxos: false,                  //  NOT SUPPORTED: Xverse does not provide UTXO access
      getBitcoinUtxos: false,           //  NOT SUPPORTED: No UTXO methods available
      getCapabilities: true,            //  NEW: wallet capabilities info
      runes: true,                      //  CONFIRMED: runes_getBalance, runes_transfer, mint, etch
      eventListeners: true,             // addListener for events
      networkSwitch: false,             // No network switching
      brc20: false,                     // No BRC-20 support
      arc20: false,                     // No ARC-20 support
      atomicals: false                  // No Atomicals support
    };
  }

  isInstalled() {
    try {
      if (typeof window === 'undefined') return false;
      return !!getInjectedXverseProvider();
    } catch {
      return false;
    }
  }

  getProvider() {
    try {
      return getInjectedXverseProvider();
    } catch {
      return null;
    }
  }

  async connect() {
    this.requireInstalled();

    try {
      const provider = this.getProvider();

      if (!provider) {
        throw new Error('Xverse provider not available (injection missing)');
      }

      // Prefer sats-connect style getAddresses payload.
      // Some Xverse builds require wallet_connect first; some return empty arrays.
      const purposes = ['ordinals', 'payment'];
      const altPurposes = ['payment', 'ordinals'];
      const message = 'Address for receiving Ordinals and payments';

      const sanitize = (r) => {
        try {
          const o = _parseMaybeJson(r);
          if (!o || typeof o !== 'object') return { type: typeof o };
          return {
            keys: Object.keys(o).slice(0, 25),
            status: o.status,
            jsonrpc: o.jsonrpc,
            hasResult: !!o.result,
            resultKeys: o.result && typeof o.result === 'object' ? Object.keys(o.result).slice(0, 25) : undefined,
          };
        } catch {
          return { type: typeof r };
        }
      };

      const attempt = async (label, method, params) => {
        let res;
        try {
          res = await _requestCompat(provider, method, params);
        } catch (e) {
          return { ok: false, error: e, response: null, addresses: null, label };
        }
        const addrs = _coerceAddressesFromResponse(res);
        if (Array.isArray(addrs) && addrs.length > 0) {
          return { ok: true, error: null, response: res, addresses: addrs, label };
        }
        return { ok: false, error: null, response: res, addresses: addrs, label };
      };

      const attempts = [];
      const plan = [
        ['getAddresses(network Mainnet)', 'getAddresses', { purposes, message, network: { type: 'Mainnet' } }],
        ['getAddresses(network mainnet)', 'getAddresses', { purposes, message, network: { type: 'mainnet' } }],
        ['getAddresses(no network)', 'getAddresses', { purposes, message }],
        ['getAddresses(no network alt purposes)', 'getAddresses', { purposes: altPurposes, message }],
        ['wallet_connect(no params)', 'wallet_connect', undefined],
        ['wallet_connect(with params)', 'wallet_connect', { purposes, message, network: { type: 'Mainnet' } }],
      ];

      let addresses = null;
      for (const [label, method, params] of plan) {
        const result = await attempt(label, method, params);
        attempts.push(result);
        if (result.ok) {
          addresses = result.addresses;
          break;
        }
        // Fast-fail on user rejection — don't show additional popups
        if (result.error) {
          const errCode = result.error.code || result.error?.cause?.code;
          const errMsg = (result.error.message || '').toLowerCase();
          if (errCode === 4001 || errMsg.includes('reject') || errMsg.includes('cancel') || errMsg.includes('denied')) {
            throw _asError(result.error, 'Xverse connection rejected by user');
          }
        }
      }

      const lastNonNull = [...attempts].reverse().find(a => a.response !== null) || null;
      const lastSnapshot = lastNonNull ? sanitize(lastNonNull.response) : null;

      // Some Xverse builds expose connect(token) style auth as well.
      if ((!addresses || (Array.isArray(addresses) && addresses.length === 0)) && typeof provider.connect === 'function') {
        try {
          const token = createUnsecuredToken({
            purposes,
            message,
            network: { type: 'Mainnet' }
          });
          console.warn('Xverse returned 0 addresses; retrying via provider.connect(token)...');
          const res2 = await provider.connect(token);
          addresses = _coerceAddressesFromResponse(res2);
        } catch (eConnect) {
          console.warn('Xverse provider.connect(token) fallback failed:', eConnect?.message || eConnect);
        }
      }

      if (!Array.isArray(addresses) || addresses.length === 0) {
        const meta = lastSnapshot ? ` (lastResponse=${JSON.stringify(lastSnapshot)})` : '';
        throw new Error(`No addresses returned from Xverse${meta}`);
      }

      const ordinalsAccount = addresses.find(acc => {
        const p = _purposeLower(acc);
        return p === 'ordinals' || p.includes('ord') || p.includes('taproot') || _addrLooksTaproot(acc?.address);
      });
      const paymentAccount = addresses.find(acc => {
        const p = _purposeLower(acc);
        return p === 'payment' || p.includes('pay') || p.includes('p2w') || _addrLooksSegwit(acc?.address);
      });

      const fallback0 = addresses[0] || null;
      const fallback1 = addresses[1] || fallback0;

      // Be lenient: some environments return only one purpose initially.
      const ordAcc = ordinalsAccount || (fallback0 && (_addrLooksTaproot(fallback0.address) ? fallback0 : null)) || fallback0;
      const payAcc = paymentAccount || (fallback0 && (_addrLooksSegwit(fallback0.address) ? fallback0 : null)) || fallback1;

      if (!ordAcc || !payAcc) {
        throw new Error('Missing usable address data from Xverse');
      }

      this.paymentAddress = payAcc.address;
      this.ordinalsAddress = ordAcc.address;
      this.paymentPublicKey = payAcc.publicKey;
      this.ordinalsPublicKey = ordAcc.publicKey;
      this.address = this.ordinalsAddress; // Use ordinals address as primary
      this.isConnected = true;

      console.log('Xverse connected:', {
        ordinals: this.ordinalsAddress,
        payment: this.paymentAddress,
        ordinalsPublicKey: this.ordinalsPublicKey,
        paymentPublicKey: this.paymentPublicKey
      });

      return { 
        address: this.address,
        paymentAddress: this.paymentAddress,
        ordinalsAddress: this.ordinalsAddress,
        paymentPublicKey: this.paymentPublicKey,
        ordinalsPublicKey: this.ordinalsPublicKey
      };
    } catch (error) {
      // Always throw a real Error with a message so UI logs aren't blank.
      const wrapped = _asError(error, 'Xverse connection failed');
      try {
        // Use real console for the failure path (no secrets, just message).
        debugWarn(wrapped.message);
      } catch {
        // ignore
      }
      throw wrapped;
    }
  }

  async getAddress() {
    this.requireConnected();
    return this.ordinalsAddress || this.address;
  }

  /**
    * Get all addresses (payment and ordinals) using sats-connect-compatible provider requests.
    * This code does not import the sats-connect library; it uses the same method names and payload shapes
    * against the injected provider.
    * Docs reference: https://docs.xverse.app/sats-connect/bitcoin-methods/getaddresses
   * @param {Array<string>} purposes - Array of address purposes ['ordinals', 'payment']
   * @returns {Promise<Array>} Array of address objects with {address, publicKey, purpose}
   */
  async getAddresses(purposes = ['ordinals', 'payment']) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      console.log('Xverse: Requesting getAddresses with purposes:', purposes);
      
      // Use Sats Connect getAddresses method
      const response = await _requestCompat(provider, 'getAddresses', {
        purposes: purposes,
        message: 'App requesting addresses'
      });
      
      console.log('Xverse getAddresses response:', response);
      
      if (response && response.result && response.result.addresses) {
        return response.result.addresses;
      }
      
      // Fallback to cached addresses from connection
      return [
        {
          purpose: 'ordinals',
          address: this.ordinalsAddress,
          publicKey: this.ordinalsPublicKey
        },
        {
          purpose: 'payment',
          address: this.paymentAddress,
          publicKey: this.paymentPublicKey
        }
      ];
    } catch (error) {
      console.warn('Xverse getAddresses failed, using cached addresses:', error);
      
      // Return cached addresses from connection
      return [
        {
          purpose: 'ordinals',
          address: this.ordinalsAddress,
          publicKey: this.ordinalsPublicKey
        },
        {
          purpose: 'payment',
          address: this.paymentAddress,
          publicKey: this.paymentPublicKey
        }
      ];
    }
  }

  async getBalance() {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      if (!provider || typeof provider.request !== 'function') {
        console.warn('Xverse provider does not have request method');
        return 0;
      }
      
      // Use Xverse's getBalance method via request
      // According to sats-connect docs: request('getBalance', undefined)
      // The wallet automatically returns balance for the connected payment address
      console.log('Xverse: Requesting getBalance...');
      const response = await _requestCompat(provider, 'getBalance', undefined);
      
      console.log('Xverse getBalance response:', response);
      
      // Handle both JSON-RPC 2.0 format and sats-connect format
      let balance;
      
      if (response && response.jsonrpc === '2.0' && response.result) {
        // JSON-RPC 2.0 format: { jsonrpc: "2.0", result: { confirmed, unconfirmed, total }, id }
        balance = response.result;
      } else if (response && response.status === 'success' && response.result) {
        // sats-connect format: { status: "success", result: { confirmed, unconfirmed, total } }
        balance = response.result;
      } else if (response && response.status === 'error') {
        throw new Error(response.error?.message || 'Failed to get balance from Xverse');
      } else {
        console.warn('Unexpected response format from Xverse getBalance:', response);
        return 0;
      }
      
      if (balance && balance.total) {
        console.log('Xverse balance (sats):', balance);
        
        // balance = { confirmed: "123456", unconfirmed: "0", total: "123456" }
        // All values are strings in satoshis — return normalized sats object.
        // The SDK aggregator handles conversion to BTC.
        return {
          confirmed: parseInt(balance.confirmed || '0', 10),
          unconfirmed: parseInt(balance.unconfirmed || '0', 10),
          total: parseInt(balance.total, 10)
        };
      } else {
        console.warn('No balance data in response');
        return { confirmed: 0, unconfirmed: 0, total: 0 };
      }
    } catch (error) {
      console.error('Xverse getBalance failed:', error);
      // Throw to let caller handle — don't return non-standard error objects
      throw new Error(`Xverse getBalance failed: ${error.message || 'Unknown error'}`);
    }
  }

  async getInscriptions(offset = 0, limit = 100) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      const address = this.ordinalsAddress || this.address;
      
      console.log(` Xverse: Fetching inscriptions for ${address} (offset: ${offset}, limit: ${limit})`);
      
      // Use wallet connector request method (JSON-RPC pattern)
      const response = await _requestCompat(provider, 'ord_getInscriptions', {
        offset: offset,
        limit: limit
      });
      
      console.log('Xverse inscriptions response:', response);
      
      // Check for error in response
      if (response && response.status === 'error') {
        console.error('Xverse inscriptions error:', response.error);
        throw new Error(response.error.message || 'Failed to get inscriptions');
      }
      
      // Extract inscriptions from result
      const inscriptions = response?.result?.inscriptions || response?.inscriptions || [];
      
      return inscriptions.map(inscription => ({
        inscriptionId: inscription.inscriptionId || inscription.id,
        inscriptionNumber: inscription.inscriptionNumber || inscription.number,
        contentType: inscription.contentType || inscription.content_type,
        contentLength: inscription.contentLength || inscription.content_length,
        contentBody: `/content/${inscription.inscriptionId || inscription.id}`,
        timestamp: inscription.timestamp,
        genesisTransaction: inscription.genesisTransaction || inscription.genesis_transaction,
        location: inscription.location,
        output: inscription.output,
        outputValue: inscription.outputValue || inscription.output_value
      }));
    } catch (error) {
      console.error('Failed to fetch Xverse inscriptions:', error);
      throw error;
    }
  }
  //  getAllInscriptions() inherited from BaseWalletProvider
  // Provides automatic pagination - no need to override


  async signPSBT(psbtHex, options = {}) {
    this.requireConnected();

    if (!psbtHex || typeof psbtHex !== 'string') {
      throw new Error('Invalid PSBT: must be a non-empty string');
    }

    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Xverse provider not available');
      }

      console.log('Xverse: Input options:', JSON.stringify(options, null, 2));

      // Prefer not to rely on wallet-broadcast for complex flows, but if the caller
      // explicitly requests native broadcast (e.g. simple single-tx sends), allow it.
      const shouldBroadcast = !!options.broadcast;

      // Derive allowed sighash types.
      // OODL offer signing requires SIGHASH_SINGLE|ANYONECANPAY (0x83) on specific inputs.
      const allowedSighashTypes = (() => {
        const values = [];
        if (Array.isArray(options?.sighashTypes)) values.push(...options.sighashTypes);
        if (Array.isArray(options?.toSignInputs)) {
          for (const item of options.toSignInputs) {
            if (!item || typeof item !== 'object') continue;
            if (Array.isArray(item.sighashTypes)) values.push(...item.sighashTypes);
            if (item.sighashType != null) values.push(item.sighashType);
          }
        }
        const normalized = values
          .map(v => Number(v))
          .filter(v => Number.isFinite(v));
        return Array.from(new Set(normalized));
      })();
      let inputsToSign = [];
      
      if (options.toSignInputs && Array.isArray(options.toSignInputs)) {
        console.log('Converting toSignInputs to sats-connect inputsToSign format');
        
        // Two parallel groupings:
        //   signInputsByAddress  → { address: [indexes] }   for the legacy signInputs object format (Sats Connect v1)
        //   signInputsByAddrSigHash → groups by (address, sighashType) for the inputsToSign array format (Sats Connect v2)
        // Mac Xverse / newer builds require sigHash per-input via inputsToSign; older builds use signInputs.
        const signInputsByAddress = {};
        const signInputsByAddrSigHash = {};
        options.toSignInputs.forEach(input => {
          if (input.address && typeof input.index !== 'undefined') {
            // Validate address matches one of our known addresses
            const isPayment = input.address === this.paymentAddress;
            const isOrdinals = input.address === this.ordinalsAddress;
            
            if (!isPayment && !isOrdinals) {
              console.warn(` Unknown address in input ${input.index}: ${input.address}`);
              console.warn(`   Expected payment: ${this.paymentAddress}`);
              console.warn(`   Expected ordinals: ${this.ordinalsAddress}`);
            } else {
              console.log(` Input ${input.index}: ${isPayment ? 'PAYMENT' : 'ORDINALS'} address`);
            }
            
            // Legacy signInputs: group by address only
            if (!signInputsByAddress[input.address]) {
              signInputsByAddress[input.address] = [];
            }
            signInputsByAddress[input.address].push(input.index);

            // Sats Connect v2 inputsToSign: group by (address, sighashType) so non-standard
            // sighash types (e.g. 0x83 SIGHASH_SINGLE|ANYONECANPAY) get their own entry with
            // an explicit sigHash field — required by Mac Xverse for 0x83 offer signing.
            const rawSigHash = input.sighashType != null ? Number(input.sighashType)
              : (Array.isArray(input.sighashTypes) && input.sighashTypes.length > 0 ? Number(input.sighashTypes[0]) : null);
            const sigHashVal = (rawSigHash != null && Number.isFinite(rawSigHash)) ? rawSigHash : null;
            const groupKey = `${input.address}::${sigHashVal ?? 'default'}`;
            if (!signInputsByAddrSigHash[groupKey]) {
              const entry = { address: input.address, signingIndexes: [] };
              if (sigHashVal != null) entry.sigHash = sigHashVal;
              signInputsByAddrSigHash[groupKey] = entry;
            }
            signInputsByAddrSigHash[groupKey].signingIndexes.push(input.index);
          }
        });
        
        // inputsToSign uses the sighash-aware grouping (Sats Connect v2 format)
        inputsToSign = Object.values(signInputsByAddrSigHash);
        
        console.log('Converted inputsToSign (with sigHash where applicable):', JSON.stringify(inputsToSign));
        console.log('Address/PubKey mapping:');
        inputsToSign.forEach(item => {
          if (item.address === this.paymentAddress) {
            console.log(`   ${item.address} (PAYMENT) -> pubkey: ${this.paymentPublicKey}`);
          } else if (item.address === this.ordinalsAddress) {
            console.log(`   ${item.address} (ORDINALS) -> pubkey: ${this.ordinalsPublicKey}`);
          }
        });
      }
      // Fallback: Handle signInputs format from normalizer
      else if (options.signInputs && typeof options.signInputs === 'object') {
        console.log('Converting signInputs to inputsToSign format');
        inputsToSign = Object.entries(options.signInputs).map(([address, signingIndexes]) => ({
          address,
          signingIndexes
        }));
        console.log('Converted from signInputs:', inputsToSign);
      }

      // XVERSE/SATS-CONNECT FORMAT per docs: https://docs.xverse.app/sats-connect/bitcoin-methods/signpsbt
      // Structure: request('signPsbt', { psbt: base64string, signInputs: {address: [indexes]}, broadcast })
      // Convert inputsToSign array format to signInputs object format
      const signInputs = {};
      inputsToSign.forEach(item => {
        //  Important behavior note: Only include addresses that actually have inputs to sign!
        // Xverse returns "No taproot scripts signed" if we pass an address with no inputs
        if (Array.isArray(item.signingIndexes) && item.signingIndexes.length > 0) {
          signInputs[item.address] = item.signingIndexes;
          console.log(` Including ${item.address.slice(0, 10)}... with ${item.signingIndexes.length} input(s): [${item.signingIndexes.join(', ')}]`);
        } else {
          console.warn(` Skipping address ${item.address} - no inputs to sign (${item.signingIndexes?.length || 0} indexes)`);
        }
      });
      
      // Validate we have at least one address with inputs
      if (Object.keys(signInputs).length === 0) {
        throw new Error('signInputs is empty - no addresses with inputs to sign!');
      }
      
      console.log('Final signInputs (filtered):', JSON.stringify(signInputs, null, 2));
      
      // � Important behavior note: Xverse/Sats Connect expects BASE64, but we're receiving HEX!
      // The variable name "psbtHex" is misleading - check format and convert if needed
      const isHex = /^[0-9a-fA-F]+$/.test(psbtHex);
      const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(psbtHex) && !isHex; // Must be ONLY base64 chars
      
      // � DIAGNOSTIC: Check PSBT structure to understand the error
      console.log('PSBT Diagnostic:');
      console.log(`   PSBT format: ${isHex ? 'HEX' : isBase64 ? 'BASE64' : 'UNKNOWN'}`);
      console.log(`   Addresses in signInputs: ${Object.keys(signInputs).length}`);
      Object.keys(signInputs).forEach(addr => {
        const isTaproot = addr.startsWith('bc1p') || addr.startsWith('tb1p');
        const isNativeSegwit = addr.startsWith('bc1q') || addr.startsWith('tb1q');
        const isWrappedSegwit = addr.startsWith('3') || addr.startsWith('2');
        console.log(`   - ${addr.slice(0, 10)}...: ${isTaproot ? 'P2TR (Taproot)' : isNativeSegwit ? 'P2WPKH (Native SegWit)' : isWrappedSegwit ? 'P2SH-P2WPKH (Wrapped SegWit)' : 'Unknown'} - inputs: [${signInputs[addr].join(', ')}]`);
      });
      
      //  Try to decode PSBT to see total inputs (diagnostic only)
      try {
        const psbtForDecode = normalizePsbtFormat(psbtHex, 'Xverse', 'output');
        // Simple check: PSBT magic bytes + version
        if (psbtForDecode.startsWith('70736274ff')) {
          // Count inputs by looking for input separators (rough estimate)
          const inputCount = (psbtForDecode.match(/0000000000/g) || []).length;
          console.log(`    PSBT appears to have ~${inputCount} input(s) total`);
          console.log(`    We're asking Xverse to sign ${Object.values(signInputs).flat().length} of them`);
          
          const allInputIndexes = Object.values(signInputs).flat();
          if (inputCount > allInputIndexes.length) {
            console.warn(`     PSBT has MORE inputs than we're signing!`);
            console.warn(`     This might mean input ${inputCount - 1} is unsigned (e.g., inscription tapscript)`);
            console.warn(`     Xverse might be confused by the unsigned Taproot input`);
          }
        }
      } catch (e) {
        console.log(`     Could not decode PSBT for diagnostic: ${e.message}`);
      }
      
      let psbtBase64;
      if (isHex) {
        // Convert HEX to BASE64 for Xverse
        console.log('Converting PSBT from HEX to BASE64 for Xverse...');
        psbtBase64 = normalizePsbtFormat(psbtHex, 'Xverse', 'input');
        console.log('Original HEX length:', psbtHex.length, 'chars');
        console.log('Converted BASE64 length:', psbtBase64.length, 'chars');
        console.log('First 50 chars of BASE64:', psbtBase64.substring(0, 50));
      } else if (isBase64) {
        console.log('PSBT already in BASE64 format');
        psbtBase64 = psbtHex;
      } else {
        throw new Error('Invalid PSBT format: neither HEX nor BASE64');
      }
      
      console.log('Xverse: Calling request("signPsbt") with Sats Connect format');
      console.log('signInputs:', JSON.stringify(signInputs, null, 2));
      
      // Broadcasting via wallet APIs can be flaky for complex flows.
      // Default is no-broadcast; allow native broadcast when explicitly requested by the caller.
      console.log('broadcast:', shouldBroadcast);
      
      // Sats Connect format: psbt is BASE64 string, signInputs is object
      const requestParams = {
        psbt: psbtBase64,
        signInputs: signInputs,
        broadcast: shouldBroadcast
      };

      // Sats Connect v2 / Mac Xverse: also pass inputsToSign array format with per-input sigHash.
      // Mac Xverse is stricter and requires sigHash on the input entry itself (not just allowedSighashTypes)
      // when signing non-standard sighash types like 0x83 (SIGHASH_SINGLE|ANYONECANPAY).
      // Including both formats ensures compatibility across all Xverse versions and platforms.
      const inputsToSignFinal = inputsToSign.filter(i => Array.isArray(i.signingIndexes) && i.signingIndexes.length > 0);
      if (inputsToSignFinal.length > 0) {
        requestParams.inputsToSign = inputsToSignFinal;
      }

      // Provide a sighash whitelist when available (OODL offer signing needs 0x83).
      if (Array.isArray(allowedSighashTypes) && allowedSighashTypes.length) {
        requestParams.sighashTypes = allowedSighashTypes;
        requestParams.allowedSighashTypes = allowedSighashTypes;
        requestParams.allowedSighash = allowedSighashTypes;
      }

      const response = await _requestCompat(provider, 'signPsbt', requestParams);

      // Handle signPsbt response
      // Response formats:
      // • broadcast: true → { status: "success", result: { txid } } (no psbtBase64!)
      // • broadcast: false → { status: "success", result: { psbtBase64 } }
      // • JSON-RPC → { jsonrpc: "2.0", result: { psbt, txid }, id }
      // • Error → { jsonrpc: "2.0", error: { code, message }, id }
      console.log('Xverse request("signPsbt") response:', response);
      
      // Check for JSON-RPC error first
      if (response && response.jsonrpc === '2.0' && response.error) {
        const errorCode = response.error.code;
        const errorMessage = response.error.message || 'PSBT signing failed';
        console.error('Xverse JSON-RPC error:', errorCode, errorMessage);
        
        // User rejection codes
        if (errorCode === 'USER_REJECTION' || errorCode === 4001) {
          throw new Error('User rejected the signing request');
        }
        
        //  XVERSE LIMITATION: "No taproot scripts signed" error
        // This occurs when the PSBT has multiple inputs and Xverse tries to sign Taproot inputs
        // but encounters inputs it cannot sign (e.g., tapscript paths)
        if (errorMessage.includes('No taproot scripts signed') || errorMessage.includes('taproot')) {
          console.error('XVERSE LIMITATION DETECTED:');
          console.error('Error: "No taproot scripts signed"');
          console.error('');
          console.error('This happens when:');
          console.error('1. PSBT has multiple inputs (e.g., parent + inscription)');
          console.error('2. Some inputs are Taproot tapscript (inscription input)');
          console.error('3. Xverse tries to sign ALL Taproot inputs, not just the ones specified');
          console.error('');
          console.error('WORKAROUND OPTIONS:');
          console.error('A) Use Magic Eden or UniSat wallet (better Taproot support)');
          console.error('B) Use single-input inscriptions (no parent)');
          console.error('C) Wait for Xverse to fix multi-input Taproot PSBT handling');
          console.error('');
          console.error('Technical: Reveal PSBT has 2 inputs:');
          console.error('- Input 0: Parent inscription (key-path, wallet signs)');
          console.error('- Input 1: Inscription output (tapscript, local signing)');
          console.error('Xverse sees input 1 and tries to sign it, but cannot.');
          
          throw new Error(
            'Xverse cannot sign parent-child inscriptions. ' +
            'This is a known Xverse limitation with multi-input Taproot PSBTs. ' +
            'Please use Magic Eden or UniSat wallet for parent-child inscriptions, ' +
            'or create inscriptions without parents.'
          );
        }
        
        // Throw actual error from Xverse
        throw new Error(errorMessage);
      }
      
      //  Check if wallet broadcasted automatically (only if txid WITHOUT psbt)
      // NOTE: Xverse v1.6.1 ignores broadcast flag and always returns PSBT
      // Future versions may return txid when auto-broadcast is implemented
      if (response && response.result && response.result.txid && !response.result.psbtBase64 && !response.result.psbt) {
        console.log('Xverse broadcast successful! Transaction ID:', response.result.txid);
        console.log('(No signed PSBT returned - wallet broadcasted directly)');
        // Return special object indicating broadcast happened
        return {
          broadcasted: true,
          txid: response.result.txid,
          message: 'Xverse broadcasted transaction automatically'
        };
      }
      
      if (response && response.status === 'success' && response.result) {
        // Standard sats-connect response format
        // Xverse v1.6.1: Always returns PSBT even with broadcast: true
        const psbtBase64 = response.result.psbtBase64 || response.result.psbt || response.result;
        if (!psbtBase64) {
          throw new Error('No signed PSBT in response result');
        }
        console.log('Xverse PSBT signed successfully via request("signPsbt")');
        console.log('Xverse v1.6.1 ignores broadcast flag - manual broadcast required');
        //  Convert BASE64 → HEX for consistency with signing.js expectations
        const psbtHex = normalizePsbtFormat(psbtBase64, 'Xverse', 'output');
        console.log('Converted signed PSBT: BASE64 → HEX for downstream processing');
        return psbtHex;
      } else if (response && response.status === 'error') {
        // Error response from sats-connect
        const errorCode = response.error?.code;
        if (errorCode === 'USER_REJECTION' || errorCode === 4001) {
          throw new Error('User rejected the signing request');
        }
        throw new Error(response.error?.message || 'PSBT signing failed');
      } else if (response && response.jsonrpc === '2.0' && response.result) {
        // JSON-RPC success format
        // Check for broadcast response first (future-proofing)
        if (response.result.txid && !response.result.psbt && !response.result.psbtBase64) {
          console.log('Xverse broadcast successful! Transaction ID:', response.result.txid);
          return {
            broadcasted: true,
            txid: response.result.txid,
            message: 'Xverse broadcasted transaction automatically'
          };
        }
        // Otherwise, signed PSBT response (current v1.6.1 behavior)
        // Xverse v1.6.1 returns {result: {psbt: "base64string"}} even with broadcast: true
        const psbtBase64 = response.result.psbt || response.result.psbtBase64;
        if (!psbtBase64) {
          throw new Error('No signed PSBT in JSON-RPC result');
        }
        console.log('Xverse PSBT signed successfully (JSON-RPC format)');
        console.log('Xverse v1.6.1 ignores broadcast flag - manual broadcast required');
        //  Convert BASE64 → HEX for consistency with signing.js expectations
        const psbtHex = normalizePsbtFormat(psbtBase64, 'Xverse', 'output');
        console.log('Converted signed PSBT: BASE64 → HEX for downstream processing');
        return psbtHex;
      } else if (response && response.psbtBase64) {
        // Fallback: direct response format (some wallet versions)
        console.log('Xverse PSBT signed successfully (direct format)');
        //  Convert BASE64 → HEX for consistency with signing.js expectations
        const psbtHex = normalizePsbtFormat(response.psbtBase64, 'Xverse', 'output');
        console.log('Converted signed PSBT: BASE64 → HEX for downstream processing');
        return psbtHex;
      }

      throw new Error('Invalid response format from Xverse wallet');
    } catch (error) {
      console.error('Xverse PSBT signing failed:', error);
      const errorMessage = error?.message || 'Unknown Xverse signing error';
      throw new Error(`Xverse: ${errorMessage}`);
    }
  }

  // Alias for standard interface (camelCase)
  async signPsbt(psbtHex, options = {}) {
    return await this.signPSBT(psbtHex, options);
  }

  /**
   * Broadcast a signed PSBT transaction
   *  NOTE: Xverse automatic broadcast is attempted via signPsbt({ broadcast: true })
   * This method is a fallback for when automatic broadcast fails or is unsupported
   * @param {string} psbtHexOrBase64 - Signed PSBT in hex or base64 format
   * @param {Object} options - Broadcast options
   * @returns {Promise<string>} Transaction ID
   */
  async pushPsbt(psbtHexOrBase64, options = {}) {
    console.warn('Xverse: Manual broadcast required');
    console.warn('(Automatic broadcast via signPsbt should be attempted first)');
    console.warn('Throwing error to trigger manual broadcast UI...');
    
    // Throw error with specific Xverse flag to trigger user-friendly modal
    const error = new Error('Xverse requires manual broadcast');
    error.walletType = 'Xverse';
    error.requiresManualBroadcast = true;
    throw error;
  }

  /**
   * Broadcast a raw signed transaction
   *  NOTE: Xverse automatic broadcast is attempted via signPsbt({ broadcast: true })
   * This method is a fallback for when automatic broadcast fails or is unsupported
   * @param {string} txHex - Raw transaction hex
   * @returns {Promise<string>} Transaction ID
   */
  async pushTx(txHex) {
    console.warn('Xverse: Manual broadcast required');
    console.warn('(Automatic broadcast via signPsbt should be attempted first)');
    console.warn('Throwing error to trigger manual broadcast UI...');
    
    // Throw error with specific Xverse flag to trigger user-friendly modal
    const error = new Error('Xverse requires manual broadcast');
    error.walletType = 'Xverse';
    error.requiresManualBroadcast = true;
    throw error;
  }

  async sendBitcoin(toAddress, amount) {
    this.requireConnected();
    BaseWalletProvider.validateSendParams(toAddress, amount);

    try {
      const provider = this.getProvider();
      // Per Xverse sats-connect docs: request('sendTransfer', { recipients })
      // recipients[].amount is number in satoshis (not amountSats)
      // https://docs.xverse.app/sats-connect/bitcoin-methods/sendtransfer
      const response = await _requestCompat(provider, 'sendTransfer', {
        recipients: [{
          address: toAddress,
          amount: Number(amount)
        }]
      });

      // Handle sats-connect response format
      if (response.status === 'success') {
        console.log('Transaction sent:', response.result.txid);
        return response.result.txid;
      } else if (response.status === 'error') {
        throw new Error(response.error?.message || 'sendTransfer failed');
      }

      console.log('Transaction sent:', response.txid || response.result?.txid);
      return response.txid || response.result?.txid;
    } catch (error) {
      console.error('Failed to send Bitcoin:', error);
      throw error;
    }
  }

  // Note: Xverse does not support UTXO fetching through their API
  // The getInfo method does not exist in sats-connect
  // If UTXOs are needed, use a different wallet like UniSat or Wizz

  /**
   * Get wallet capabilities
   * @returns {Promise<Object>} Wallet capabilities
   */
  async getCapabilities() {
    this.requireConnected();
    
    try {
      return {
        walletType: 'Xverse',
        methods: Object.keys(this.features).filter(key => this.features[key] === true),
        features: {
          multiAddress: true,
          runes: true,
          inscriptions: true,
          batchOperations: true,
          utxos: false  // Xverse does not support UTXO fetching
        },
        addresses: {
          payment: this.paymentAddress,
          ordinals: this.ordinalsAddress
        }
      };
    } catch (error) {
      console.error('Failed to get capabilities:', error);
      throw error;
    }
  }

  async signMessage(message) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      const result = await _requestCompat(provider, 'signMessage', {
        address: this.ordinalsAddress || this.address,
        message: message
      });

      return result;
    } catch (error) {
      console.error('Failed to sign message:', error);
      throw error;
    }
  }

  /**
   * Sign a transaction using native Xverse signTransaction method
   * @param {string} psbtBase64 - Base64 encoded PSBT
   * @param {Object} options - Signing options
   * @returns {Promise<Object>} Signed transaction result
   */
  async signTransaction(psbtBase64, options = {}) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      const result = await provider.signTransaction(psbtBase64, options);
      console.log('Transaction signed via Xverse signTransaction');
      return result;
    } catch (error) {
      console.error('Failed to sign transaction:', error);
      throw error;
    }
  }

  /**
   * Sign multiple transactions at once using native Xverse method
   * @param {Array<string>} psbtBase64s - Array of Base64 encoded PSBTs
   * @param {Object} options - Signing options
   * @returns {Promise<Array<Object>>} Array of signed transaction results
   */
  async signMultipleTransactions(psbtBase64s, options = {}) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      const results = await provider.signMultipleTransactions(psbtBase64s, options);
      console.log(` ${results.length} transactions signed via Xverse`);
      return results;
    } catch (error) {
      console.error('Failed to sign multiple transactions:', error);
      throw error;
    }
  }

  /**
   * Create an inscription using native Xverse createInscription method
   * @param {Object} inscriptionData - Inscription data
   * @param {string} inscriptionData.content - Content to inscribe (base64 for binary, string for text)
   * @param {string} inscriptionData.contentType - MIME type (e.g., 'text/plain', 'image/png')
   * @param {Object} options - Additional options (fee rate, etc.)
   * @returns {Promise<Object>} Inscription result with txid
   */
  async createInscription(inscriptionData, options = {}) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      const result = await provider.createInscription({
        ...inscriptionData,
        ...options
      });
      console.log('Inscription created via Xverse:', result);
      return result;
    } catch (error) {
      console.error('Failed to create inscription:', error);
      throw error;
    }
  }

  /**
   * Create multiple identical inscriptions in a single transaction
   * Xverse-specific batch inscription feature
   * @param {Object} payload - Inscription payload with repeat count
   * @returns {Promise<Object>} Batch inscription result with txids
   */
  async createRepeatInscriptions(payload) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Xverse provider not found');
      }

      console.log('Xverse: Creating repeat inscriptions with payload:', {
        repeat: payload.repeat,
        contentType: payload.contentType,
        payloadType: payload.payloadType,
        feeRate: payload.suggestedMinerFeeRate
      });

      // Create JWT token using shared utility - same as inscribe
      const token = createUnsecuredToken(payload);
      console.log('Xverse: Created JWT token for repeat inscriptions request');

      // Call createRepeatInscriptions method with JWT token
      const response = await provider.createRepeatInscriptions(token);
      
      console.log('Xverse repeat inscriptions response:', response);

      // Handle response
      if (!response) {
        throw new Error('No response from Xverse wallet');
      }

      if (response.error) {
        throw new Error(response.error.message || 'Provider returned an error');
      }

      // Extract result
      const result = {
        txId: response.txId,
        inscriptionIds: response.inscriptionIds || [],
        count: payload.repeat
      };

      console.log(` ${payload.repeat} inscriptions created via Xverse:`, result);
      return result;
    } catch (error) {
      console.error('Failed to create repeat inscriptions:', error);
      
      // Handle user cancellation
      if (error.code === 4001 || error.message?.includes('cancel')) {
        throw new Error('Batch inscription cancelled by user');
      }
      
      throw new Error(`Batch inscription failed: ${error.message}`);
    }
  }

  async getNetwork() {
    // Xverse defaults to mainnet
    return 'mainnet';
  }

  async getPublicKey() {
    this.requireConnected();

    // Return ordinals public key (preferred for inscriptions)
    return this.ordinalsPublicKey || this.paymentPublicKey;
  }

  async getAccounts() {
    this.requireConnected();

    // Return cached account info from connection
    return [
      {
        purpose: 'ordinals',
        address: this.ordinalsAddress,
        publicKey: this.ordinalsPublicKey
      },
      {
        purpose: 'payment',
        address: this.paymentAddress,
        publicKey: this.paymentPublicKey
      }
    ];
  }

  /**
   * Expose provider state for SDK safety checks (segregated wallet detection, etc.)
   * Mirrors the shape expected by inscriber.js (paymentAddress, ordinalsAddress)
   */
  getState() {
    return {
      wallet: 'Xverse',
      connected: !!this.isConnected,
      network: 'mainnet',
      paymentAddress: this.paymentAddress,
      ordinalsAddress: this.ordinalsAddress,
      paymentPublicKey: this.paymentPublicKey,
      ordinalsPublicKey: this.ordinalsPublicKey,
    };
  }

  /**
   * Get all inscriptions with automatic pagination
   * @returns {Promise<Array>} All inscriptions
   */

  /**
   * Create inscription via Xverse wallet using native provider
   * No external dependencies - uses JWT token method directly
   * @param {string|ArrayBuffer} content - Content to inscribe
   * @param {Object} options - Inscription options
   * @returns {Promise<{inscriptionId: string, txId: string}>}
   */
  async inscribe(content, options = {}) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Xverse provider not found');
      }

      const {
        contentType = 'text/plain;charset=utf-8',
        feeRate = 10,
        receiverAddress,
        devAddress,
        devFee = 0
      } = options;

      // Determine payload type based on content
      let payloadType = 'PLAIN_TEXT';
      let processedContent = content;

      // If content is ArrayBuffer or we have image/binary content type, use BASE_64
      if (content instanceof ArrayBuffer || contentType.startsWith('image/')) {
        payloadType = 'BASE_64';
        
        // Convert ArrayBuffer to base64 if needed
        if (content instanceof ArrayBuffer) {
          const bytes = new Uint8Array(content);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          processedContent = btoa(binary);
        }
      }

      // Build inscription payload following Xverse/sats-connect format
      const inscriptionPayload = {
        contentType,
        content: processedContent,
        payloadType,
        network: { type: 'Mainnet' }
      };

      // Add optional parameters
      if (feeRate) {
        inscriptionPayload.suggestedMinerFeeRate = feeRate;
      }

      if (devAddress && devFee > 0) {
        inscriptionPayload.appFeeAddress = devAddress;
        inscriptionPayload.appFee = devFee;
      }

      console.log('Xverse: Creating inscription with payload:', {
        contentType: inscriptionPayload.contentType,
        payloadType: inscriptionPayload.payloadType,
        contentLength: processedContent.length,
        feeRate: inscriptionPayload.suggestedMinerFeeRate,
        hasServiceFee: !!(devAddress && devFee)
      });

      // Create JWT token using shared utility
      const token = createUnsecuredToken(inscriptionPayload);
      console.log('Xverse: Created JWT token for inscription request');

      // Call createInscription method with JWT token
      const response = await provider.createInscription(token);
      
      console.log('Xverse inscription response:', response);

      // Handle response
      if (!response) {
        throw new Error('No response from Xverse wallet');
      }

      if (response.error) {
        throw new Error(response.error.message || 'Provider returned an error');
      }

      // Extract result
      const result = {
        txId: response.txId,
        inscriptionId: response.inscriptionId || response.txId
      };

      console.log('Xverse inscription created:', result);
      return result;

    } catch (error) {
      console.error('Xverse inscribe error:', error);
      
      // Handle user cancellation
      if (error.code === 4001 || error.message?.includes('cancel')) {
        throw new Error('Inscription cancelled by user');
      }
      
      throw new Error(`Inscription failed: ${error.message}`);
    }
  }

  /**
   * Get Runes balance for the connected wallet
   * Uses Xverse's runes_getBalance method
   * @returns {Promise<Object>} Runes balance data
   */
  async getRunesBalance() {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      console.log('Xverse: Requesting runes_getBalance...');
      const response = await _requestCompat(provider, 'runes_getBalance', undefined);
      
      console.log('Xverse runes balance:', response);
      
      if (response && response.result) {
        return response.result;
      }
      
      return response;
    } catch (error) {
      console.error('Xverse getRunesBalance failed:', error);
      throw error;
    }
  }

  /**
   * Transfer Runes to another address
   * Uses Xverse's runes_transfer method
   * @param {Object} transferParams - Transfer parameters
   * @param {string} transferParams.recipient - Recipient address
   * @param {string} transferParams.runeName - Name of the rune to transfer
   * @param {string} transferParams.amount - Amount to transfer
   * @returns {Promise<Object>} Transfer result with txid
   */
  async transferRunes(transferParams) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      console.log('Xverse: Transferring runes:', transferParams);
      const response = await _requestCompat(provider, 'runes_transfer', transferParams);
      
      console.log('Xverse runes transfer:', response);
      return response;
    } catch (error) {
      console.error('Xverse transferRunes failed:', error);
      throw error;
    }
  }

  /**
   * Mint Runes
   * Uses Xverse's rune minting method
   * @param {Object} mintParams - Mint parameters
   * @returns {Promise<Object>} Mint result with txid
   */
  async mintRunes(mintParams) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      console.log('Xverse: Minting runes:', mintParams);
      const response = await _requestCompat(provider, 'runes_mint', mintParams);
      
      console.log('Xverse runes mint:', response);
      return response;
    } catch (error) {
      console.error('Xverse mintRunes failed:', error);
      throw error;
    }
  }

  /**
   * Etch (create) new Runes
   * Uses Xverse's rune etching method
   * @param {Object} etchParams - Etch parameters
   * @returns {Promise<Object>} Etch result with txid
   */
  async etchRunes(etchParams) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      console.log('Xverse: Etching runes:', etchParams);
      const response = await _requestCompat(provider, 'runes_etch', etchParams);
      
      console.log('Xverse runes etch:', response);
      return response;
    } catch (error) {
      console.error('Xverse etchRunes failed:', error);
      throw error;
    }
  }

  /**
   * Get Runes order status
   * Uses Xverse's runes_getOrder method
   * @param {string} orderId - Order ID to check
   * @returns {Promise<Object>} Order status
   */
  async getRunesOrder(orderId) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      console.log('Xverse: Getting runes order:', orderId);
      const response = await _requestCompat(provider, 'runes_getOrder', { orderId });
      
      console.log('Xverse runes order:', response);
      return response;
    } catch (error) {
      console.error('Xverse getRunesOrder failed:', error);
      throw error;
    }
  }

  /**
   * Send inscriptions to another address
   * Uses Xverse's ord_sendInscriptions method
   * @param {Object} sendParams - Send parameters
   * @param {string} sendParams.recipient - Recipient address
   * @param {Array<string>} sendParams.inscriptionIds - Array of inscription IDs to send
   * @returns {Promise<Object>} Send result with txid
   */
  async sendInscriptions(sendParams) {
    this.requireConnected();

    try {
      const provider = this.getProvider();
      
      console.log('Xverse: Sending inscriptions:', sendParams);
      const response = await _requestCompat(provider, 'ord_sendInscriptions', sendParams);
      
      console.log('Xverse inscriptions sent:', response);
      return response;
    } catch (error) {
      console.error('Xverse sendInscriptions failed:', error);
      throw error;
    }
  }
}

export default XverseProvider;
