/**
 * Wallet signing wrapper (shared)
 *
 * Purpose:
 * - Prefer batch signing when available (signPsbts)
 * - Fall back to sequential signing (signPsbt)
 * - Normalize options so wallets that require `sighashTypes` arrays still work
 *
 * Keep this in `inscriptionslocal/` so it can be synced across projects.
 */

function normalizeSignOptions(opt) {
  if (!opt || typeof opt !== 'object') return opt;
  const out = { ...opt };

  // Some providers use `inputsToSign` instead of `toSignInputs`.
  // Normalize by mirroring so downstream wallet adapters can read either.
  if (!Array.isArray(out.toSignInputs) && Array.isArray(out.inputsToSign)) {
    out.toSignInputs = out.inputsToSign;
  }
  if (!Array.isArray(out.inputsToSign) && Array.isArray(out.toSignInputs)) {
    out.inputsToSign = out.toSignInputs;
  }

  // Some wallets (incl. some UniSat builds) only honor the array-form `sighashTypes` whitelist.
  // Normalize so callers can pass `sighashType` and still work reliably.
  if (Array.isArray(out.toSignInputs)) {
    const normalizedInputs = out.toSignInputs.map((ti) => {
      if (!ti || typeof ti !== 'object') return ti;
      const tiOut = { ...ti };
      const st = tiOut.sighashType;

      if (typeof st === 'number') {
        if (!Array.isArray(tiOut.sighashTypes)) {
          tiOut.sighashTypes = [st];
        } else if (!tiOut.sighashTypes.includes(st)) {
          tiOut.sighashTypes = [...tiOut.sighashTypes, st];
        }
      }
      return tiOut;
    });

    out.toSignInputs = normalizedInputs;
    out.inputsToSign = normalizedInputs;

    // If no top-level whitelist provided, derive it from per-input requested sighashes.
    if (!Array.isArray(out.sighashTypes)) {
      const derived = [];
      for (const ti of out.toSignInputs) {
        if (ti && typeof ti === 'object') {
          const st = ti.sighashType;
          if (typeof st === 'number' && !derived.includes(st)) derived.push(st);
          const arr = ti.sighashTypes;
          if (Array.isArray(arr)) {
            for (const v of arr) {
              if (typeof v === 'number' && !derived.includes(v)) derived.push(v);
            }
          }
        }
      }
      if (derived.length) out.sighashTypes = derived;
    }
  }

  return out;
}

function __nexusWalletDebugEnabled() {
  try {
    // Use globalThis so this works in both browser and Node.
    return typeof globalThis !== 'undefined' && globalThis.NEXUS_WALLET_DEBUG === true;
  } catch {
    return false;
  }
}

function debugWarn(...args) {
  if (__nexusWalletDebugEnabled() && typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(...args);
  }
}

function getWalletTypeLower(walletOrProvider) {
  try {
    return (
      walletOrProvider?.walletType?.toLowerCase?.() ||
      walletOrProvider?.name?.toLowerCase?.() ||
      walletOrProvider?.providerName?.toLowerCase?.() ||
      walletOrProvider?.id?.toLowerCase?.() ||
      walletOrProvider?.constructor?.name?.toLowerCase?.() ||
      ''
    );
  } catch {
    return '';
  }
}

async function tryBatchSigner(signer, psbts, optionsArray) {
  if (!signer || typeof signer.signPsbts !== 'function') return null;

  try {
    const norm = Array.isArray(optionsArray)
      ? optionsArray.map(normalizeSignOptions)
      : normalizeSignOptions(optionsArray);

    return await signer.signPsbts(psbts, norm);
  } catch (err) {
    // If signPsbts exists but is flaky/not supported in this build, fall back to sequential.
    debugWarn('⚠️ Batch signing failed, will try sequential:', err?.message || String(err));
    return null;
  }
}

async function trySingleSigner(signer, psbts, optionsArray) {
  if (!signer || typeof signer.signPsbt !== 'function') return null;

  const out = [];
  for (let i = 0; i < psbts.length; i++) {
    const perOpt = Array.isArray(optionsArray) ? (optionsArray[i] || {}) : (optionsArray || {});
    try {
      out.push(await signer.signPsbt(psbts[i], normalizeSignOptions(perOpt)));
    } catch (err) {
      const msg = err?.message || String(err);
      throw new Error(`Wallet signPsbt failed for index ${i}: ${msg}`);
    }
  }
  return out;
}

function coerceSignedPsbts(res, expectedCount) {
  // Some wallet wrappers may return a single string even from a batch call.
  if (typeof res === 'string') {
    if (expectedCount === 1) return [res];
    return null;
  }
  if (!Array.isArray(res)) return null;
  if (typeof expectedCount === 'number' && expectedCount > 0 && res.length !== expectedCount) return null;
  return res;
}

/**
 * Sign N PSBTs with best-effort wallet compatibility.
 *
 * @param {object} walletOrProvider - Provider adapter (preferred) or raw wallet instance.
 * @param {string[]} psbts - PSBTs (already in the provider's expected format)
 * @param {object|object[]} [optionsArray] - Single options object or per-PSBT options array
 * @returns {Promise<string[]>} signed PSBTs (same encoding as provider returns)
 */
export async function signPsbtsWithFallback(walletOrProvider, psbts, optionsArray) {
  if (!Array.isArray(psbts) || psbts.length === 0) {
    throw new Error('signPsbtsWithFallback: psbts must be a non-empty array');
  }

  for (let i = 0; i < psbts.length; i++) {
    if (typeof psbts[i] !== 'string' || !psbts[i]) {
      throw new Error(`signPsbtsWithFallback: psbts[${i}] must be a non-empty string`);
    }
  }

  // Skip batch attempt for known single-PSBT signers to avoid unnecessary errors and delays.
  // Also avoid batch for single-PSBT calls (no upside, can trigger wallet-specific quirks).
  // Xverse is included: its batch-signing popup is unreliable for sequential multi-parcel listings.
  const walletTypeLower = getWalletTypeLower(walletOrProvider);
  const skipBatch = walletTypeLower.includes('leather') || walletTypeLower.includes('phantom') || walletTypeLower.includes('xverse');
  const forceSingle = psbts.length === 1;

  const attempts = [];
  if (walletOrProvider) attempts.push({ label: 'provider', signer: walletOrProvider });
  if (walletOrProvider?.walletInstance) attempts.push({ label: 'rawWallet', signer: walletOrProvider.walletInstance });

  const errors = [];
  for (const a of attempts) {
    if (!a?.signer) continue;

    if (!(skipBatch || forceSingle)) {
      try {
        const batchRes = await tryBatchSigner(a.signer, psbts, optionsArray);
        const coerced = coerceSignedPsbts(batchRes, psbts.length);
        if (coerced) return coerced;
      } catch (err) {
        errors.push({ attempt: `${a.label}.signPsbts`, error: err });
      }
    }

    try {
      const singleRes = await trySingleSigner(a.signer, psbts, optionsArray);
      const coerced = coerceSignedPsbts(singleRes, psbts.length);
      if (coerced) return coerced;
    } catch (err) {
      errors.push({ attempt: `${a.label}.signPsbt`, error: err });
    }
  }

  const last = errors[errors.length - 1]?.error;
  const lastMsg = last?.message || (errors.length ? String(last) : 'No compatible wallet signing method found (signPsbts or signPsbt)');
  const walletHint = walletTypeLower ? ` (wallet=${walletTypeLower})` : '';
  throw new Error(`Wallet signing failed${walletHint}: ${lastMsg}`);
}
