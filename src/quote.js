import { createHash } from "node:crypto";
import { nearEd25519Key } from "./keys.js";

// DCAP quote v4 header is 48 bytes. Tee type 0x81 is Intel TDX.
// TDREPORT 1.0 then places MRTD at byte 136 of the report (quote byte 184):
// tee_tcb_svn 16, mrseam 48, mrsignerseam 48, seamattributes 8,
// tdattributes 8, xfam 8, then MRTD. MRCONFIGID, MROWNER, and
// MROWNERCONFIG follow, 48 bytes each, then RTMR0 through RTMR3.
// The SVRN quote in fixtures/svrn-01.submit.json has those digests there.
export const QUOTE_LAYOUT = {
  version: 4,
  teeType: 0x81,
  mrtd: 184,
  rtmr0: 376,
  rtmr1: 424,
  rtmr2: 472,
  rtmr3: 520,
  reportData: 568,
  digestLength: 48,
  reportDataLength: 64,
};

const DIGEST_FIELDS = ["mrtd", "rtmr0", "rtmr1", "rtmr2", "rtmr3"];

export function quoteBytes(hex) {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0) {
    return { ok: false, reason: "quote hex is missing or has an odd length" };
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return { ok: false, reason: "quote hex has a non-hex character" };
  }
  return { ok: true, bytes: Buffer.from(hex, "hex") };
}

export function parseTdxQuote(input) {
  const bytes = Buffer.isBuffer(input) ? input : quoteBytes(input).bytes;
  if (!bytes) {
    return quoteBytes(input);
  }
  const minimum = QUOTE_LAYOUT.reportData + QUOTE_LAYOUT.reportDataLength;
  if (bytes.length < minimum) {
    return { ok: false, reason: "quote is shorter than a TDX report" };
  }
  const version = bytes.readUInt16LE(0);
  const teeType = bytes.readUInt32LE(4);
  if (version !== QUOTE_LAYOUT.version || teeType !== QUOTE_LAYOUT.teeType) {
    return {
      ok: false,
      reason: "quote header is not TDX quote v4",
      version,
      teeType,
    };
  }
  const digests = {};
  for (const name of DIGEST_FIELDS) {
    const offset = QUOTE_LAYOUT[name];
    digests[name] = bytes.subarray(offset, offset + QUOTE_LAYOUT.digestLength).toString("hex");
  }
  const reportData = bytes.subarray(
    QUOTE_LAYOUT.reportData,
    QUOTE_LAYOUT.reportData + QUOTE_LAYOUT.reportDataLength,
  );
  return { ok: true, version, teeType, reportData, ...digests };
}

export function expectedReportData(tlsPublicKey, accountPublicKey) {
  const digest = createHash("sha3-384")
    .update(Buffer.concat([nearEd25519Key(tlsPublicKey), nearEd25519Key(accountPublicKey)]))
    .digest();
  const reportData = Buffer.alloc(QUOTE_LAYOUT.reportDataLength);
  reportData.writeUInt16BE(1, 0);
  digest.copy(reportData, 2);
  return reportData;
}

export function reportDataBinds(reportData, tlsPublicKey, accountPublicKey) {
  if (!Buffer.isBuffer(reportData) || reportData.length !== QUOTE_LAYOUT.reportDataLength) {
    return false;
  }
  return reportData.equals(expectedReportData(tlsPublicKey, accountPublicKey));
}
