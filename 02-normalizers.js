/**
 * Data Normalizers - Utility Module
 */

/**
 * Normalize inscription data from different wallet formats
 * @param {Object} inscription - Raw inscription data from wallet
 * @param {string} walletName - Name of wallet for format detection
 * @returns {Object} Normalized inscription object
 */
export function normalizeInscription(inscription, walletName) {
  // Base normalized format
  const normalized = {
    inscriptionId: inscription.inscriptionId || inscription.id,
    inscriptionNumber: inscription.inscriptionNumber || inscription.number,
    address: inscription.address,
    outputValue: inscription.outputValue || inscription.output_value || inscription.value,
    content: inscription.content,
    contentType: inscription.contentType || inscription.content_type || inscription.mimeType,
    contentLength: inscription.contentLength || inscription.content_length,
    timestamp: inscription.timestamp,
    genesisTransaction: inscription.genesisTransaction || inscription.genesis_transaction || inscription.genesis_tx,
    location: inscription.location,
    output: inscription.output,
    offset: inscription.offset
  };

  // Wallet-specific adjustments
  switch (walletName) {
    case 'Xverse':
      normalized.contentType = inscription.contentType || inscription.mimeType;
      normalized.inscriptionNumber = inscription.number;
      break;
      
    case 'UniSat':
      normalized.contentType = inscription.contentType;
      normalized.inscriptionNumber = inscription.inscriptionNumber;
      break;
      
    case 'OKX':
      break;
  }

  return normalized;
}

export function normalizeBalance(balance, walletName) {
  if (typeof balance === 'number') {
    return {
      confirmed: balance,
      unconfirmed: 0,
      total: balance
    };
  }

  const normalized = {
    confirmed: balance.confirmed || balance.amount || balance.total || 0,
    unconfirmed: balance.unconfirmed || balance.pending || 0,
    total: 0
  };

  // Note: total is always recalculated AFTER wallet-specific adjustments below.
  // We intentionally do NOT trust balance.total here because wallet-specific
  // branches may reassign confirmed/unconfirmed to different source fields.

  switch (walletName) {
    case 'Xverse':
      normalized.confirmed = balance.confirmed || 0;
      normalized.unconfirmed = balance.unconfirmed || 0;
      break;
      
    case 'UniSat':
      normalized.confirmed = balance.confirm || balance.confirmed || 0;
      normalized.unconfirmed = balance.pending || balance.unconfirmed || 0;
      break;
  }

  normalized.total = normalized.confirmed + normalized.unconfirmed;
  return normalized;
}

export function normalizePsbtOptions(options, walletName) {
  const normalized = {
    autoFinalized: options.autoFinalized !== false,
    toSignInputs: options.toSignInputs || options.inputsToSign || []
  };

  switch (walletName) {
    case 'Xverse':
      if (options.toSignInputs && Array.isArray(options.toSignInputs)) {
        const signInputs = {};
        options.toSignInputs.forEach(input => {
          const addr = input.address;
          if (!signInputs[addr]) {
            signInputs[addr] = [];
          }
          if (typeof input.index === 'number') {
            signInputs[addr].push(input.index);
          }
        });
        normalized.signInputs = signInputs;
      }
      break;
      
    case 'UniSat':
      normalized.toSignInputs = options.toSignInputs || [];
      break;
      
    case 'OKX':
      normalized.toSignInputs = options.toSignInputs || [];
      break;
      
    case 'Phantom':
      // Phantom expects inputsToSign array with { address, signingIndexes }.
      // IMPORTANT: Phantom may have multiple accounts/addresses (ordinals + payment).
      // Group signing indexes by the per-input address so each account signs only its inputs.
      if (options.toSignInputs && Array.isArray(options.toSignInputs)) {
        const byAddr = new Map();
        for (const input of options.toSignInputs) {
          if (!input || typeof input !== 'object') continue;
          const idx = input.index;
          if (typeof idx !== 'number' || !Number.isFinite(idx)) continue;
          const addr = (typeof input.address === 'string' && input.address.trim())
            ? input.address.trim()
            : (typeof options.address === 'string' && options.address.trim())
              ? options.address.trim()
              : (typeof options.defaultAddress === 'string' && options.defaultAddress.trim())
                ? options.defaultAddress.trim()
                : null;
          if (!addr) continue;
          if (!byAddr.has(addr)) byAddr.set(addr, []);
          byAddr.get(addr).push(idx);
        }

        const inputsToSign = Array.from(byAddr.entries()).map(([address, signingIndexes]) => ({
          address,
          signingIndexes,
        }));

        if (inputsToSign.length) normalized.inputsToSign = inputsToSign;
      }
      break;
  }

  return normalized;
}

export function normalizeNetwork(network) {
  const networkLower = (network || '').toLowerCase();
  
  if (networkLower.includes('main') || networkLower.includes('live')) {
    return 'livenet';
  }
  if (networkLower.includes('test')) {
    return 'testnet';
  }
  
  return 'livenet';
}

export function normalizeAddress(address) {
  if (typeof address === 'string') {
    return address;
  }
  
  if (typeof address === 'object' && address !== null) {
    return address.address || address.value || String(address);
  }
  
  return '';
}

export function normalizeProviderMethods(provider) {
  if (!provider) return provider;
  
  const normalized = { ...provider };
  
  if (!normalized.signPsbt && provider.signPSBT) {
    normalized.signPsbt = provider.signPSBT.bind(provider);
  }
  
  return normalized;
}

export function normalizePsbtFormat(psbt, walletName, direction = 'input') {
  if (!psbt || typeof psbt !== 'string') {
    throw new Error('Invalid PSBT: must be a non-empty string');
  }

  const hasBuffer = () => (typeof Buffer !== 'undefined' && Buffer && typeof Buffer.from === 'function');

  const hexToBytes = (hex) => {
    const clean = String(hex || '').trim();
    if (!/^[0-9a-fA-F]+$/.test(clean) || (clean.length % 2 !== 0)) {
      throw new Error('Invalid hex string');
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
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
      throw new Error('Base64 encoding not available in this environment');
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
      throw new Error('Base64 decoding not available in this environment');
    }
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  const hexToBase64 = (hex) => bytesToBase64(hexToBytes(hex));
  const base64ToHex = (b64) => bytesToHex(base64ToBytes(b64));

  const s = String(psbt).trim();
  const isHex = /^[0-9a-fA-F]+$/.test(s) && (s.length % 2 === 0);
  // Important: hex strings are a strict subset of the base64 charset.
  // Never treat something as base64 if it already looks like valid hex.
  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(s) && !isHex;

  if (!isHex && !isBase64) {
    throw new Error('PSBT must be in hex or base64 format');
  }

  // Validate PSBT magic bytes (psbt\xff = 0x70736274ff)
  // Prevents random hex/base64 strings from being forwarded to wallet providers.
  const PSBT_MAGIC_HEX = '70736274ff';
  const PSBT_MAGIC_B64 = 'cHNidP8';

  if (isHex && !s.toLowerCase().startsWith(PSBT_MAGIC_HEX)) {
    throw new Error('Invalid PSBT: missing magic bytes (hex must start with 70736274ff)');
  }
  if (isBase64 && !s.startsWith(PSBT_MAGIC_B64)) {
    throw new Error('Invalid PSBT: missing magic bytes (base64 must start with cHNidP8)');
  }

  const walletFormats = {
    'Leather': 'base64',
    'Xverse': 'base64',
    'UniSat': 'hex',
    'OKX': 'hex',
    'MagicEden': 'base64'
  };

  if (direction === 'input') {
    const targetFormat = walletFormats[walletName] || 'hex';
    
    if (targetFormat === 'base64' && isHex) {
      return hexToBase64(s);
    }
    if (targetFormat === 'hex' && isBase64) {
      return base64ToHex(s);
    }
    return s;
    
  } else {
    if (isBase64) {
      return base64ToHex(s);
    }
    return s;
  }
}

export const normalizers = {
  inscription: normalizeInscription,
  balance: normalizeBalance,
  psbtOptions: normalizePsbtOptions,
  network: normalizeNetwork,
  address: normalizeAddress,
  providerMethods: normalizeProviderMethods,
  psbtFormat: normalizePsbtFormat
};

export default normalizers;
