import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DOES_NOT_MATCH, judgeQuote, judgeStored, MATCHES, submissionFromArgs } from "../src/check.js";
import { checkIntelSignature } from "../src/intel.js";
import { renderPage } from "../src/page.js";
import { QUOTE_LAYOUT } from "../src/quote.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const submission = JSON.parse(readFileSync(path.join(root, "fixtures", "svrn-01.submit.json"), "utf8"));
const parsed = submissionFromArgs(submission);
const tcb = submission.proposed_participant_attestation.Dstack.tcb_info;
const accountKey = "ed25519:GdrMw9r1TSEQunU3XiCfH8JJ4LWueLWZe8QvtUbPfPnh";
const allowed = {
  mrtd: tcb.mrtd,
  rtmr0: tcb.rtmr0,
  rtmr1: tcb.rtmr1,
  rtmr2: tcb.rtmr2,
  key_provider_event_digest: "61ce56b6be756a9e45af7715b13c15040a4e6090cc740be24e2cc02e33b4fb53ae4e3c945c9af83e2a26c6d5efa414a8",
};

test("the SVRN quote body carries the tcb_info digests at the TDREPORT offsets", () => {
  const quote = judgeQuote(parsed.quoteHex, [allowed], parsed.tlsPublicKey, accountKey);
  assert.equal(quote.status, MATCHES);
  assert.equal(quote.binding, "binds this node's keys");
  assert.equal(quote.mrtd, tcb.mrtd);
  assert.equal(quote.rtmr0, tcb.rtmr0);
  assert.equal(quote.rtmr1, tcb.rtmr1);
  assert.equal(quote.rtmr2, tcb.rtmr2);
  assert.equal(quote.rtmr3, tcb.rtmr3);
});

test("flipping one MRTD byte makes the quote not match", () => {
  const bytes = Buffer.from(parsed.quoteHex, "hex");
  bytes[QUOTE_LAYOUT.mrtd] ^= 0xff;
  const quote = judgeQuote(bytes.toString("hex"), [allowed], parsed.tlsPublicKey, accountKey);
  assert.equal(quote.status, DOES_NOT_MATCH);
});

test("a stored attestation matches only when all five fields match", () => {
  const stored = judgeStored(
    {
      attestation: {
        Dstack: {
          mpc_image_hash: "536d528f19cff6a45f384fb225e8a331e5554b9da45196d0fae148d191e8b36d",
          launcher_compose_hash: "f99d6a7958fd44ccf2569d9ad49da3b2e0248ca3364f36e8f2466d7bf2cf4444",
          expiry_timestamp_seconds: 1794229331,
          measurements: allowed,
        },
      },
      accepted_at_seconds: 1793624531,
    },
    [allowed],
  );
  assert.equal(stored.status, MATCHES);
  const flipped = structuredClone(allowed);
  flipped.key_provider_event_digest = "00" + allowed.key_provider_event_digest.slice(2);
  const rejected = judgeStored(
    {
      attestation: { Dstack: { measurements: flipped } },
      accepted_at_seconds: 1793624531,
    },
    [allowed],
  );
  assert.equal(rejected.status, DOES_NOT_MATCH);
});

test("a missing attestation stays missing", () => {
  assert.equal(judgeStored(null, [allowed]).status, "missing");
  assert.equal(judgeQuote(null, [allowed], parsed.tlsPublicKey, accountKey).status, "missing");
});

test("the SVRN on-chain collateral checks at acceptance and at the snapshot time", () => {
  const collateral = submission.proposed_participant_attestation.Dstack.collateral;
  const result = checkIntelSignature(parsed.quoteHex, collateral, {
    acceptance: 1793624531,
    now: 1793627763,
  });
  assert.equal(result.collateralSource, "on-chain collateral");
  assert.equal(result.root, "Intel production root");
  assert.equal(result.library, "@phala/dcap-qvl");
  assert.equal(result.libraryVersion, "0.7.0");
  assert.equal(result.acceptance.status, "signature checked");
  assert.equal(result.now.status, "signature checked");
  assert.equal(result.acceptance.tcbStatus, "UpToDate");
  assert.equal(result.now.tcbStatus, "UpToDate");
  assert.deepEqual(result.acceptance.advisoryIds, []);
  assert.deepEqual(result.now.advisoryIds, []);
  assert.equal(result.acceptance.checkedAtSeconds, 1793624531);
  assert.equal(result.now.checkedAtSeconds, 1793627763);
  const html = renderPage(pageReport([{ ...pageRow(), signature: result }]));
  assert.equal(html.includes("verified"), false);
  assert.equal(html.includes("signature checked"), true);
  assert.equal(html.includes("TCB UpToDate"), true);
  assert.equal(html.includes("on-chain collateral"), true);
});

test("a flipped collateral signature fails and does not report a TCB status", () => {
  const collateral = structuredClone(submission.proposed_participant_attestation.Dstack.collateral);
  const signature = collateral.tcb_info_signature;
  collateral.tcb_info_signature = `${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
  const result = checkIntelSignature(parsed.quoteHex, collateral, {
    acceptance: 1793624531,
    now: 1793624531,
  });
  assert.equal(result.acceptance.status, "signature failed");
  assert.equal(result.now.status, "signature failed");
  assert.equal(result.acceptance.tcbStatus, null);
  assert.equal(result.collateralSource, "on-chain collateral");
});

function pageRow() {
  return {
    accountId: "svrn-01.near",
    participantId: 13,
    stored: { status: "matches", acceptedAtSeconds: 1793624531, expiryTimestampSeconds: 1794229331 },
    quote: { status: "matches", binding: "binds this node's keys" },
    image: { status: "matches" },
    compose: { status: "matches" },
    submissionTx: "8kQuS5VeEg3aDJek7AG2F9QGRuu3Y4gqybZWGWRi9Vhi",
  };
}

function pageReport(rows) {
  return {
    summary: "A read.",
    counts: { sentence: "1 of 1 current participants have an on-chain attestation that matches." },
    version: "3.17.0",
    teeVerifier: "tee-verifier-2026-08-04.near",
    rpc: "https://rpc.fastnear.com",
    stateBlock: { height: 1, hash: "abc", timestampNs: "1793624529751966492" },
    epochId: 14,
    participantCount: 1,
    threshold: 11,
    teeUpgradeDeadlineSeconds: 604800,
    olderEpoch: "An older block was not read.",
    indexer: "https://api.nearblocks.io",
    allowedMeasurements: [allowed],
    domains: [{ id: 0, protocol: "CaitSith", purpose: "Sign", threshold: 11, attempt: 0, publicKey: "secp256k1:example" }],
    calls: [{ method: "state", blockHeight: 1, blockHash: "abc" }],
    rows,
  };
}

test("the page names a match without calling it verified", () => {
  const html = renderPage(pageReport([pageRow()]));
  assert.equal(html.includes("verified"), false);
  assert.equal(html.includes("signature not checked"), true);
  assert.equal(html.includes("svrn-01.near"), true);
  assert.equal(html.includes("matches"), true);
  const escaped = renderPage({
    summary: "<script>",
    counts: { sentence: "0 of 0" },
    version: "3.17.0",
    teeVerifier: "tee.near",
    rpc: "https://rpc.example",
    stateBlock: { height: 1, hash: "abc", timestampNs: "1" },
    epochId: 1,
    participantCount: 0,
    threshold: 1,
    teeUpgradeDeadlineSeconds: 1,
    olderEpoch: "none",
    indexer: "https://indexer.example",
    allowedMeasurements: [allowed],
    domains: [],
    calls: [],
    rows: [
      {
        accountId: `<img src=x>`,
        participantId: null,
        stored: { status: "missing", acceptedAtSeconds: null, expiryTimestampSeconds: null },
        quote: { status: "missing", binding: "not checked" },
        image: { status: "missing" },
        compose: { status: "missing" },
        submissionTx: null,
      },
    ],
  });
  assert.equal(escaped.includes("<img src=x>"), false);
  assert.equal(escaped.includes("&lt;img src=x&gt;"), true);
  assert.equal(escaped.includes("<script>"), false);
});
