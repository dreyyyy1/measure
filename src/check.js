import { parseTdxQuote, reportDataBinds } from "./quote.js";

export const MATCHES = "matches";
export const DOES_NOT_MATCH = "does not match";
export const MISSING = "missing";

const STORED_FIELDS = ["mrtd", "rtmr0", "rtmr1", "rtmr2", "key_provider_event_digest"];
const QUOTE_FIELDS = ["mrtd", "rtmr0", "rtmr1", "rtmr2"];

export function sameHex(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

export function storedMeasurementsMatch(measurements, allowed) {
  if (!measurements || !allowed) return false;
  return STORED_FIELDS.every((field) => sameHex(measurements[field], allowed[field]));
}

export function quoteMeasurementsMatch(measurements, allowed) {
  if (!measurements || !allowed) return false;
  return QUOTE_FIELDS.every((field) => sameHex(measurements[field], allowed[field]));
}

function statusAgainst(list, predicate) {
  if (!Array.isArray(list) || list.length === 0) return MISSING;
  return list.some(predicate) ? MATCHES : DOES_NOT_MATCH;
}

export function judgeStored(stored, allowedMeasurements) {
  if (!stored) {
    return { status: MISSING, reason: "get_attestation returned no attestation" };
  }
  const dstack = stored.attestation && stored.attestation.Dstack;
  if (!dstack || !dstack.measurements) {
    return { status: DOES_NOT_MATCH, reason: "stored attestation is not a Dstack attestation" };
  }
  const status = statusAgainst(allowedMeasurements, (allowed) =>
    storedMeasurementsMatch(dstack.measurements, allowed),
  );
  return {
    status,
    reason: status === MATCHES ? "five stored fields equal one allowed_os_measurements entry" : "five stored fields equal no allowed_os_measurements entry",
    measurements: dstack.measurements,
    mpcImageHash: dstack.mpc_image_hash ?? null,
    launcherComposeHash: dstack.launcher_compose_hash ?? null,
    expiryTimestampSeconds: dstack.expiry_timestamp_seconds ?? null,
    acceptedAtSeconds: stored.accepted_at_seconds ?? null,
  };
}

export function judgeQuote(quoteHex, allowedMeasurements, tlsPublicKey, accountPublicKey) {
  if (typeof quoteHex !== "string" || quoteHex.length === 0) {
    return {
      status: MISSING,
      binding: "not checked",
      reason: "quote bytes are not in the submission arguments",
    };
  }
  const parsed = parseTdxQuote(quoteHex);
  if (!parsed.ok) {
    return { status: DOES_NOT_MATCH, binding: "not checked", reason: parsed.reason };
  }
  const status = statusAgainst(allowedMeasurements, (allowed) => quoteMeasurementsMatch(parsed, allowed));
  let binding = "not checked";
  if (tlsPublicKey && accountPublicKey) {
    binding = reportDataBinds(parsed.reportData, tlsPublicKey, accountPublicKey)
      ? "binds this node's keys"
      : "does not bind this node's keys";
  }
  return {
    status,
    binding,
    reason:
      status === MATCHES
        ? "quote MRTD and RTMR0–2 equal one allowed_os_measurements entry"
        : "quote MRTD and RTMR0–2 equal no allowed_os_measurements entry",
    mrtd: parsed.mrtd,
    rtmr0: parsed.rtmr0,
    rtmr1: parsed.rtmr1,
    rtmr2: parsed.rtmr2,
    rtmr3: parsed.rtmr3,
  };
}

export function judgeHash(hash, allowedHashes) {
  if (typeof hash !== "string" || hash.length === 0) return MISSING;
  if (!Array.isArray(allowedHashes) || allowedHashes.length === 0) return MISSING;
  return allowedHashes.some((allowed) => sameHex(allowed, hash)) ? MATCHES : DOES_NOT_MATCH;
}

export function submissionFromArgs(args) {
  if (!args || typeof args !== "object") return null;
  const attestation = args.proposed_participant_attestation;
  const dstack = attestation && attestation.Dstack;
  if (!dstack) return null;
  return {
    tlsPublicKey: typeof args.tls_public_key === "string" ? args.tls_public_key : null,
    quoteHex: typeof dstack.quote === "string" ? dstack.quote : null,
    collateral: dstack.collateral && typeof dstack.collateral === "object" ? dstack.collateral : null,
  };
}
