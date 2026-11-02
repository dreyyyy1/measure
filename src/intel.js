import { getCollateral, getCollateralFromPcs, PHALA_PCCS_URL, QuoteVerifier } from "@phala/dcap-qvl";

export const SIGNATURE_CHECKED = "signature checked";
export const SIGNATURE_FAILED = "signature failed";
export const SIGNATURE_NOT_CHECKED = "signature not checked";

export const INTEL_LIBRARY = "@phala/dcap-qvl";
export const INTEL_LIBRARY_VERSION = "0.7.0";

export function signatureNotChecked(reason) {
  return {
    library: INTEL_LIBRARY,
    libraryVersion: INTEL_LIBRARY_VERSION,
    collateralSource: null,
    root: null,
    acceptance: point(SIGNATURE_NOT_CHECKED, null, [], reason, null),
    now: point(SIGNATURE_NOT_CHECKED, null, [], reason, null),
  };
}

export function collateralFromDstack(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tcbInfo = jsonText(raw.tcb_info);
  const qeIdentity = jsonText(raw.qe_identity);
  if (!tcbInfo || !qeIdentity) return null;
  const collateral = {
    pck_crl_issuer_chain: pemText(raw.pck_crl_issuer_chain),
    root_ca_crl: raw.root_ca_crl,
    pck_crl: raw.pck_crl,
    tcb_info_issuer_chain: pemText(raw.tcb_info_issuer_chain),
    tcb_info: tcbInfo,
    tcb_info_signature: raw.tcb_info_signature,
    qe_identity_issuer_chain: pemText(raw.qe_identity_issuer_chain),
    qe_identity: qeIdentity,
    qe_identity_signature: raw.qe_identity_signature,
  };
  for (const field of ["pck_crl_issuer_chain", "tcb_info_issuer_chain", "qe_identity_issuer_chain", "tcb_info_signature", "qe_identity_signature", "root_ca_crl", "pck_crl"]) {
    if (typeof collateral[field] !== "string" || collateral[field].length === 0) return null;
  }
  const pckCertificate = pemText(raw.pck_certificate_chain);
  if (pckCertificate) collateral.pck_certificate_chain = pckCertificate;
  return collateral;
}

export function checkIntelSignature(quoteHex, rawCollateral, times) {
  const collateral = collateralFromDstack(rawCollateral);
  if (typeof quoteHex !== "string" || quoteHex.length === 0 || !collateral) {
    return signatureNotChecked("quote or on-chain collateral is missing");
  }
  let quote;
  try {
    quote = Buffer.from(quoteHex, "hex");
  } catch {
    return signatureNotChecked("quote hex could not be read");
  }
  if (quote.length === 0) return signatureNotChecked("quote hex could not be read");
  const verifier = QuoteVerifier.newProd();
  return {
    library: INTEL_LIBRARY,
    libraryVersion: INTEL_LIBRARY_VERSION,
    collateralSource: "on-chain collateral",
    root: "Intel production root",
    acceptance: checkAt(verifier, quote, collateral, times && times.acceptance),
    now: checkAt(verifier, quote, collateral, times && times.now),
  };
}

export async function checkFreshCollateral(quoteHex, secs) {
  const quote = Buffer.from(quoteHex, "hex");
  const verifier = QuoteVerifier.newProd();
  const attempts = [
    ["Intel PCS", () => getCollateralFromPcs(quote)],
    ["Phala PCCS", () => getCollateral(PHALA_PCCS_URL, quote)],
  ];
  const results = [];
  for (const [source, load] of attempts) {
    try {
      const collateral = await load();
      results.push({ source, ...checkAt(verifier, quote, collateral, secs) });
    } catch (error) {
      results.push({
        source,
        status: SIGNATURE_FAILED,
        tcbStatus: null,
        advisoryIds: [],
        reason: error.message,
        checkedAtSeconds: secs,
      });
    }
    if (results[results.length - 1].status === SIGNATURE_CHECKED) break;
  }
  return results;
}

function checkAt(verifier, quote, collateral, secs) {
  if (typeof secs !== "number" || !Number.isFinite(secs)) {
    return point(SIGNATURE_NOT_CHECKED, null, [], "no timestamp", null);
  }
  try {
    const report = verifier.verify(quote, collateral, secs);
    return point(SIGNATURE_CHECKED, report.status, report.advisory_ids || [], "verify() returned a report", secs);
  } catch (error) {
    return point(SIGNATURE_FAILED, null, [], error.message, secs);
  }
}

function point(status, tcbStatus, advisoryIds, reason, checkedAtSeconds) {
  return { status, tcbStatus, advisoryIds, reason, checkedAtSeconds };
}

function jsonText(value) {
  const text = unwrapString(value);
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") return null;
    return text;
  } catch {
    return null;
  }
}

function pemText(value) {
  const text = unwrapString(value);
  if (typeof text !== "string" || !text.includes("BEGIN CERTIFICATE")) return null;
  if (!text.includes("\n") && text.includes("\\n")) return text.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  return text;
}

function unwrapString(value) {
  let current = value;
  for (let step = 0; step < 5; step += 1) {
    if (typeof current !== "string") return null;
    try {
      const parsed = JSON.parse(current);
      if (typeof parsed === "string") {
        current = parsed;
        continue;
      }
      return current;
    } catch {
      if (current.includes("BEGIN CERTIFICATE") && current.includes("\n")) return current;
      try {
        const parsed = JSON.parse(`"${current}"`);
        if (typeof parsed !== "string" || parsed === current) return current;
        current = parsed;
      } catch {
        return current;
      }
    }
  }
  return typeof current === "string" ? current : null;
}
