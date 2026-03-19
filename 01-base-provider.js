/**
 * BaseWalletProvider - Foundation Module
 */

const __nexusWalletDebugEnabled = () =>
  typeof window !== 'undefined' && window.NEXUS_WALLET_DEBUG === true;

const debugWarn = (...args) => {
  if (__nexusWalletDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
};

export class BaseWalletProvider {
  constructor(name) {
    this.name = name;
    this.isConnected = false;
    this.address = null;
    this.publicKey = null;
    this.walletInstance = null;
    
    // Feature flags - override in subclasses
    this.features = {
      connect: true,
      getAddress: true,
      getPublicKey: false,
      getBalance: true,
      getNetwork: false,
      switchNetwork: false,
      signMessage: true,
      signPsbt: true,
      signPsbts: false,
      pushPsbt: false,
      pushTx: false,
      sendBitcoin: true,
      sendInscription: false,
      getInscriptions: true,
      getAllInscriptions: true,
      inscribe: false,
      brc20: {
        transfer: false,
        deploy: false,
        mint: false
      },
      runes: {
        send: false,
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

  /**
   * Helper: Check if wallet is installed
   * @throws {Error} If wallet not installed
   */
  requireInstalled() {
    if (!this.walletInstance) {
      throw new Error(`${this.name} wallet not installed or not detected`);
    }
  }

  /**
   * Helper: Check if wallet is connected
   * @throws {Error} If wallet not connected
   */
  requireConnected() {
    if (!this.isConnected || !this.address) {
      throw new Error(`${this.name} wallet not connected. Please connect first.`);
    }
  }

  /**
   * Helper: Check if method is supported.
   * Handles both nested feature objects (e.g., `brc20.transfer`) and
   * flat boolean features (e.g., `runes: true` on Xverse).
   * Safe against prototype pollution — only own properties are traversed.
   * @param {string} methodPath - Dot notation path (e.g., 'brc20.transfer')
   * @returns {boolean}
   */
  supportsMethod(methodPath) {
    if (!methodPath || typeof methodPath !== 'string') return false;
    const parts = methodPath.split('.');
    let current = this.features;
    
    for (const part of parts) {
      if (typeof current === 'object' && current !== null) {
        if (!Object.prototype.hasOwnProperty.call(current, part)) return false;
        current = current[part];
      } else {
        // Flat boolean feature — path traversal hit a non-object
        return current === true;
      }
    }
    
    return current === true;
  }

  /**
   * Helper: Safe method call with feature detection
   * @param {string} methodPath - Feature path to check
   * @param {Function} callback - Function to execute if supported
   * @param {string} errorMsg - Custom error message
   * @returns {Promise<*>}
   */
  async safeCall(methodPath, callback, errorMsg) {
    if (!this.supportsMethod(methodPath)) {
      throw new Error(errorMsg || `${this.name} does not support ${methodPath}`);
    }
    return await callback();
  }

  /**
   * Generic connect implementation
   * Override in subclass if wallet has custom connect flow
   */
  async connect() {
    this.requireInstalled();
    
    if (this.walletInstance.connect) {
      const result = await this.walletInstance.connect();
      this.isConnected = true;
      this.address = result.address || result;
      return result;
    }
    
    // Fallback for wallets without explicit connect.
    // Cannot call this.getAddress() here — it calls requireConnected() which
    // would throw since isConnected is still false at this point.
    let address = null;
    if (this.walletInstance.requestAccounts) {
      const accounts = await this.walletInstance.requestAccounts();
      address = accounts?.[0] || null;
    } else if (this.walletInstance.getAddress) {
      address = await this.walletInstance.getAddress();
    } else if (this.walletInstance.getAccounts) {
      const accounts = await this.walletInstance.getAccounts();
      address = accounts?.[0] || null;
    }
    if (!address) {
      throw new Error(`${this.name}: No method available to connect`);
    }
    this.isConnected = true;
    this.address = address;
    return { address };
  }

  /**
   * Generic disconnect implementation
   */
  async disconnect() {
    if (this.walletInstance?.disconnect) {
      await this.walletInstance.disconnect();
    }
    this.isConnected = false;
    this.address = null;
    this.publicKey = null;
  }

  /**
   * Generic getAddress implementation
   */
  async getAddress() {
    this.requireInstalled();
    this.requireConnected();
    
    if (this.walletInstance.getAddress) {
      return await this.walletInstance.getAddress();
    }
    if (this.walletInstance.requestAccounts) {
      const accounts = await this.walletInstance.requestAccounts();
      return accounts[0];
    }
    
    throw new Error(`${this.name}: No method available to get address`);
  }

  /**
   * Generic getPublicKey implementation
   */
  async getPublicKey() {
    this.requireInstalled();
    this.requireConnected();
    
    return await this.safeCall('getPublicKey', async () => {
      if (this.walletInstance.getPublicKey) {
        return await this.walletInstance.getPublicKey();
      }
      throw new Error(`${this.name}: getPublicKey not implemented`);
    });
  }

  /**
   * Generic getBalance implementation
   */
  async getBalance() {
    this.requireInstalled();
    this.requireConnected();
    
    if (this.walletInstance.getBalance) {
      const result = await this.walletInstance.getBalance();
      // Handle different return formats
      if (typeof result === 'object') {
        return result.total || result.confirmed || result.balance || 0;
      }
      return result;
    }
    
    throw new Error(`${this.name}: getBalance not implemented`);
  }

  /**
   * Generic getNetwork implementation
   */
  async getNetwork() {
    this.requireInstalled();
    
    return await this.safeCall('getNetwork', async () => {
      if (this.walletInstance.getNetwork) {
        return await this.walletInstance.getNetwork();
      }
      throw new Error(`${this.name}: getNetwork not implemented`);
    });
  }

  /**
   * Generic switchNetwork implementation
   */
  async switchNetwork(network) {
    this.requireInstalled();
    
    return await this.safeCall('switchNetwork', async () => {
      if (this.walletInstance.switchNetwork) {
        return await this.walletInstance.switchNetwork(network);
      }
      throw new Error(`${this.name}: switchNetwork not implemented`);
    });
  }

  /**
   * Generic signMessage implementation
   */
  async signMessage(message, type = 'ecdsa') {
    this.requireInstalled();
    this.requireConnected();
    
    if (this.walletInstance.signMessage) {
      return await this.walletInstance.signMessage(message, type);
    }
    
    throw new Error(`${this.name}: signMessage not implemented`);
  }

  /**
   * Generic signPsbt implementation
   */
  async signPsbt(psbtHex, options = {}) {
    this.requireInstalled();
    this.requireConnected();
    
    if (this.walletInstance.signPsbt) {
      return await this.walletInstance.signPsbt(psbtHex, options);
    }
    
    throw new Error(`${this.name}: signPsbt not implemented`);
  }

  /**
   * Generic signPsbts (batch) implementation
   */
  async signPsbts(psbtHexs, options = {}) {
    this.requireInstalled();
    this.requireConnected();
    
    return await this.safeCall('signPsbts', async () => {
      if (this.walletInstance.signPsbts) {
        return await this.walletInstance.signPsbts(psbtHexs, options);
      }
      // Fallback: sign one by one, preserving partial results on failure
      const results = [];
      for (let i = 0; i < psbtHexs.length; i++) {
        try {
          results.push(await this.signPsbt(psbtHexs[i], options));
        } catch (err) {
          const error = new Error(
            `${this.name}: Failed to sign PSBT ${i + 1}/${psbtHexs.length}: ${err.message}`
          );
          error.index = i;
          error.partialResults = [...results];
          error.cause = err;
          throw error;
        }
      }
      return results;
    });
  }

  /**
   * Generic pushPsbt implementation
   */
  async pushPsbt(psbtHex) {
    this.requireInstalled();
    this.requireConnected();
    
    return await this.safeCall('pushPsbt', async () => {
      if (this.walletInstance.pushPsbt) {
        return await this.walletInstance.pushPsbt(psbtHex);
      }
      throw new Error(`${this.name}: pushPsbt not implemented`);
    });
  }

  /**
   * Generic pushTx implementation
   */
  async pushTx(rawTx) {
    this.requireInstalled();
    this.requireConnected();
    
    return await this.safeCall('pushTx', async () => {
      if (this.walletInstance.pushTx) {
        return await this.walletInstance.pushTx(rawTx);
      }
      throw new Error(`${this.name}: pushTx not implemented`);
    });
  }

  /**
   * Validate send parameters before forwarding to wallet.
   * Call this in any sendBitcoin implementation to prevent fund loss.
   * @param {string} toAddress - Recipient Bitcoin address
   * @param {number} satoshis - Amount in satoshis
   * @throws {Error} If parameters are invalid
   */
  static validateSendParams(toAddress, satoshis) {
    if (typeof toAddress !== 'string' || !toAddress.trim()) {
      throw new Error('Invalid recipient address: must be a non-empty string');
    }

    // Basic Bitcoin address sanity: known prefix + reasonable length.
    // Catches typos, non-BTC addresses, ETH addresses, objects-coerced-to-string, etc.
    // Not a full bech32/base58check validator — wallets do final validation.
    const addr = toAddress.trim();
    const lc = addr.toLowerCase();
    const hasValidPrefix = (
      lc.startsWith('bc1q') || lc.startsWith('bc1p') ||   // mainnet segwit / taproot
      lc.startsWith('tb1q') || lc.startsWith('tb1p') ||   // testnet segwit / taproot
      lc.startsWith('bcrt1') ||                            // regtest
      /^[13mn2]/.test(addr)                                // legacy P2PKH/P2SH / testnet
    );
    if (!hasValidPrefix || addr.length < 26 || addr.length > 90) {
      throw new Error('Invalid Bitcoin address format: unrecognized prefix or length');
    }

    if (!Number.isInteger(satoshis) || satoshis <= 0) {
      throw new Error('satoshis must be a positive integer');
    }

    // Dust limits per output type (Bitcoin Core defaults at minRelayTxFee = 1000 sat/kvB).
    // The dust threshold depends on the RECIPIENT address type, not the sender's.
    const dustLimit = BaseWalletProvider._dustLimitForAddress(addr);
    if (satoshis < dustLimit) {
      throw new Error(`Amount ${satoshis} sats is below dust limit (${dustLimit} sats for this address type)`);
    }
  }

  /**
   * Return the dust-limit threshold for a Bitcoin address based on its output type.
   * Values are from Bitcoin Core's GetDustThreshold() at minRelayTxFee = 1000 sat/kvB.
   *
   * P2PKH  (1...)            → 546 sats   (3 × 182 bytes)
   * P2SH   (3...)            → 540 sats   (3 × 180 bytes)
   * P2WPKH (bc1q, 42 chars)  → 294 sats   (3 × 98 vbytes)
   * P2WSH  (bc1q, 62 chars)  → 330 sats   (3 × 110 vbytes)
   * P2TR   (bc1p, 62 chars)  → 330 sats   (3 × 110 vbytes)
   *
   * @param {string} addr - Trimmed Bitcoin address
   * @returns {number} Dust limit in satoshis
   */
  static _dustLimitForAddress(addr) {
    const lc = addr.toLowerCase();

    // Segwit v0 — distinguish P2WPKH (20-byte witness, 42 chars) from P2WSH (32-byte, 62 chars)
    if (lc.startsWith('bc1q') || lc.startsWith('tb1q')) {
      return addr.length <= 44 ? 294 : 330; // P2WPKH : P2WSH
    }
    // Taproot (P2TR) — always 32-byte witness program
    if (lc.startsWith('bc1p') || lc.startsWith('tb1p')) {
      return 330;
    }
    // Regtest
    if (lc.startsWith('bcrt1q')) {
      return addr.length <= 46 ? 294 : 330; // bcrt1q adds 2 chars vs bc1q
    }
    if (lc.startsWith('bcrt1p')) {
      return 330;
    }
    // P2SH (3... mainnet, 2... testnet)
    if (addr.startsWith('3') || addr.startsWith('2')) {
      return 540;
    }
    // P2PKH (1... mainnet, m/n... testnet) and anything else — safest default
    return 546;
  }

  /**
   * Wrap a promise with a timeout. Use for wallet operations that may hang indefinitely.
   * @param {Promise} promise - The promise to wrap
   * @param {number} [ms=30000] - Timeout in milliseconds
   * @param {string} [label='Wallet operation'] - Description for error message
   * @returns {Promise}
   */
  static withTimeout(promise, ms = 30000, label = 'Wallet operation') {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }

  /**
   * Generic sendBitcoin implementation
   */
  async sendBitcoin(toAddress, satoshis, options = {}) {
    this.requireInstalled();
    this.requireConnected();
    BaseWalletProvider.validateSendParams(toAddress, satoshis);
    
    if (this.walletInstance.sendBitcoin) {
      return await this.walletInstance.sendBitcoin(toAddress, satoshis, options);
    }
    
    throw new Error(`${this.name}: sendBitcoin not implemented`);
  }

  /**
   * Generic sendInscription implementation
   */
  async sendInscription(toAddress, inscriptionId, options = {}) {
    this.requireInstalled();
    this.requireConnected();
    
    return await this.safeCall('sendInscription', async () => {
      if (this.walletInstance.sendInscription) {
        return await this.walletInstance.sendInscription(toAddress, inscriptionId, options);
      }
      throw new Error(`${this.name}: sendInscription not implemented`);
    });
  }

  /**
   * Generic getInscriptions implementation
   */
  async getInscriptions(cursor = 0, size = 100) {
    this.requireInstalled();
    this.requireConnected();
    
    if (this.walletInstance.getInscriptions) {
      return await this.walletInstance.getInscriptions(cursor, size);
    }
    
    throw new Error(`${this.name}: getInscriptions not implemented`);
  }

  /**
   * Generic getAllInscriptions with automatic pagination
   * This is a universal helper that works across all wallets
   */
  async getAllInscriptions() {
    this.requireInstalled();
    this.requireConnected();
    
    const allInscriptions = [];
    let cursor = 0;
    const pageSize = 100;
    const maxPages = 100; // Safety limit: max 10,000 inscriptions
    let pageCount = 0;
    
    while (pageCount < maxPages) {
      const result = await this.getInscriptions(cursor, pageSize);
      
      // Handle different response formats
      const inscriptions = result.list || result.inscriptions || result;
      
      if (!Array.isArray(inscriptions) || inscriptions.length === 0) {
        break; // No more inscriptions
      }
      
      allInscriptions.push(...inscriptions);
      
      // Check if we got fewer than requested (last page)
      if (inscriptions.length < pageSize) {
        break;
      }
      
      // Rate-limit pagination to avoid API throttling
      await new Promise(r => setTimeout(r, 100));
      
      cursor += pageSize;
      pageCount++;
    }
    
    if (pageCount >= maxPages) {
      debugWarn(`${this.name}: Reached pagination safety limit (${maxPages * pageSize} inscriptions)`);
    }
    
    return allInscriptions;
  }

  /**
   * Generic inscribe implementation
   */
  async inscribe(content, options = {}) {
    this.requireInstalled();
    this.requireConnected();
    
    return await this.safeCall('inscribe', async () => {
      if (this.walletInstance.inscribe) {
        return await this.walletInstance.inscribe(content, options);
      }
      throw new Error(`${this.name}: inscribe not implemented`);
    });
  }

  /**
   * Get wallet info
   */
  getInfo() {
    return {
      name: this.name,
      isInstalled: !!this.walletInstance,
      isConnected: this.isConnected,
      address: this.address,
      publicKey: this.publicKey,
      features: this.features
    };
  }

  /**
   * Default provider state accessor for SDK safety checks.
   * Subclasses can override or extend. Uses best-effort fallbacks.
   */
  getState() {
    // Some providers define payment/ordinals fields; otherwise fall back to primary address
    const paymentAddress = this.paymentAddress || this.address || null;
    const ordinalsAddress = this.ordinalsAddress || this.address || null;
    const paymentPublicKey = this.paymentPublicKey || this.publicKey || null;
    const ordinalsPublicKey = this.ordinalsPublicKey || this.publicKey || null;
    return {
      wallet: this.name,
      connected: !!this.isConnected,
      network: null, // Subclasses must override with actual network
      paymentAddress,
      ordinalsAddress,
      paymentPublicKey,
      ordinalsPublicKey,
      address: this.address || ordinalsAddress || paymentAddress || null,
    };
  }
}

export default BaseWalletProvider;
