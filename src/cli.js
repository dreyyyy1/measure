import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeHash, judgeQuote, judgeStored, submissionFromArgs } from "./check.js";
import { checkFreshCollateral, checkIntelSignature, SIGNATURE_FAILED, signatureNotChecked } from "./intel.js";
import { renderPage } from "./page.js";
import { blockHeader, latestSubmission, viewCall, viewCallAt } from "./rpc.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpc = process.env.MEASURE_RPC || "https://rpc.fastnear.com";
const indexer = process.env.MEASURE_INDEXER || "https://api.nearblocks.io";
const archivalRpc = process.env.MEASURE_ARCHIVAL_RPC || "https://archival-rpc.mainnet.near.org";
const PRE_TEE_BLOCK = Number(process.env.MEASURE_PRE_TEE_BLOCK || 221156250);

const version = await viewCall(rpc, "version", {});
const config = await viewCall(rpc, "config", {});
const state = await viewCall(rpc, "state", {});
const allowed = await viewCall(rpc, "allowed_os_measurements", {});
const docker = await viewCall(rpc, "allowed_docker_image_hashes", {});
const compose = await viewCall(rpc, "allowed_launcher_compose_hashes", {});
const teeAccounts = await viewCall(rpc, "get_tee_accounts", {});
const verifier = await viewCall(rpc, "tee_verifier_account_id", {});

const running = state.value && state.value.Running;
if (!running) {
  throw new Error("state() is not Running");
}

const participants = new Map();
for (const entry of running.parameters.participants.participants) {
  const [accountId, participantId, info] = entry;
  participants.set(accountId, {
    participantId,
    url: info.url,
    tlsPublicKey: info.tls_public_key,
  });
}

const nodes = new Map();
for (const node of teeAccounts.value) {
  const attestation = await viewCall(rpc, "get_attestation", {
    tls_public_key: node.tls_public_key,
  });
  nodes.set(node.account_id, { node, attestation });
}

const imageHashes = docker.value.map((row) => row.image_hash);
const composeHashes = compose.value;
const rows = [];

for (const [accountId, participant] of participants) {
  rows.push(await buildRow(accountId, participant, nodes.get(accountId)));
  nodes.delete(accountId);
}
for (const [accountId, found] of nodes) {
  rows.push(await buildRow(accountId, null, found));
}
rows.sort((left, right) => {
  if (left.participantId === null) return 1;
  if (right.participantId === null) return -1;
  return left.participantId - right.participantId;
});

const current = rows.filter((row) => row.participantId !== null);
const storedMatches = current.filter((row) => row.stored.status === "matches").length;
const quoteMatches = current.filter((row) => row.quote.status === "matches").length;
const quoteMissing = current.filter((row) => row.quote.status === "missing").length;
const header = await blockHeader(rpc, state.blockHeight);
const olderEpoch = await olderEpochNote(running);

const report = {
  rpc,
  indexer,
  version: version.value,
  teeVerifier: verifier.value,
  teeUpgradeDeadlineSeconds: config.value.tee_upgrade_deadline_duration_seconds,
  epochId: running.keyset.epoch_id,
  threshold: running.parameters.threshold,
  participantCount: current.length,
  storedTeeAccounts: teeAccounts.value.length,
  stateBlock: {
    height: state.blockHeight,
    hash: state.blockHash,
    timestampNs: header && header.timestampNs,
  },
  summary:
    "Measure compares each Chain Signatures node's stored attestation with the OS measurement v1.signer publishes. get_attestation does not return quote bytes. When the indexer still has submit_participant_info, Measure reads the quote from that transaction.",
  counts: {
    storedMatches,
    quoteMatches,
    quoteMissing,
    sentence: `${storedMatches} of ${current.length} current participants have an on-chain attestation that matches the published OS measurement. ${quoteMatches} of ${current.length} have a recovered quote whose MRTD and RTMR0–2 match. ${quoteMissing} current-participant quote reads are missing.`,
  },
  olderEpoch,
  allowedMeasurements: allowed.value,
  domains: running.keyset.domains.map((domain) => ({
    id: domain.domain_id,
    protocol: running.domains.domains.find((item) => item.id === domain.domain_id)?.protocol,
    purpose: running.domains.domains.find((item) => item.id === domain.domain_id)?.purpose,
    threshold: running.domains.domains.find((item) => item.id === domain.domain_id)?.reconstruction_threshold,
    attempt: domain.attempt,
    publicKey: publicKeyOf(domain.key),
  })),
  calls: [version, config, state, allowed, docker, compose, teeAccounts, verifier].map((call) => ({
    method: call.method,
    blockHeight: call.blockHeight,
    blockHash: call.blockHash,
  })),
  rows,
};

await mkdir(path.join(root, "data"), { recursive: true });
await mkdir(path.join(root, "web"), { recursive: true });
await writeFile(path.join(root, "data", "report.json"), JSON.stringify(report, null, 2));
await writeFile(path.join(root, "web", "index.html"), renderPage(report));

console.log(report.counts.sentence);
console.log(`epoch ${report.epochId} at block ${state.blockHeight}`);
for (const row of rows) {
  console.log(
    `${row.accountId} stored=${row.stored.status} quote=${row.quote.status} reportData=${row.quote.binding} signature=${row.signature.acceptance.status}`,
  );
}
console.log("wrote data/report.json and web/index.html");

async function buildRow(accountId, participant, found) {
  const node = found && found.node;
  const stored = judgeStored(found && found.attestation.value, allowed.value);
  const image = judgeHash(stored.mpcImageHash, imageHashes);
  const imageRow = docker.value.find(
    (row) => String(row.image_hash).toLowerCase() === String(stored.mpcImageHash || "").toLowerCase(),
  );
  const composeStatus = judgeHash(stored.launcherComposeHash, composeHashes);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const submission = await latestSubmission(indexer, accountId);
  const parsed = submission.found ? submissionFromArgs(submission.args) : null;
  const tlsPublicKey = (node && node.tls_public_key) || (participant && participant.tlsPublicKey);
  const accountPublicKey = node && node.account_public_key;
  const quote = judgeQuote(parsed && parsed.quoteHex, allowed.value, tlsPublicKey, accountPublicKey);
  if (!submission.found) {
    quote.reason = submission.reason;
  } else if (parsed && parsed.tlsPublicKey && tlsPublicKey && parsed.tlsPublicKey !== tlsPublicKey) {
    quote.reason = `${quote.reason}; submission tls key differs from the key in get_tee_accounts`;
  }
  const checkedAt = Math.floor(Date.now() / 1000);
  const signature =
    parsed && parsed.quoteHex && parsed.collateral
      ? checkIntelSignature(parsed.quoteHex, parsed.collateral, {
          acceptance: stored.acceptedAtSeconds,
          now: checkedAt,
        })
      : signatureNotChecked(submission.found ? "quote or on-chain collateral is missing" : submission.reason);
  if (signature.now.status === SIGNATURE_FAILED && parsed && parsed.quoteHex) {
    signature.fresh = await checkFreshCollateral(parsed.quoteHex, checkedAt);
  }
  return {
    accountId,
    participantId: participant ? participant.participantId : null,
    url: participant ? participant.url : null,
    tlsPublicKey: tlsPublicKey || null,
    accountPublicKey: accountPublicKey || null,
    stored,
    image: {
      status: image,
      expiryTimestampSeconds: imageRow ? imageRow.expiry_timestamp_seconds : null,
    },
    compose: { status: composeStatus },
    quote,
    signature,
    submissionTx: submission.txHash || null,
    attestationBlockHeight: found ? found.attestation.blockHeight : null,
  };
}

function publicKeyOf(key) {
  if (key.Secp256k1) return key.Secp256k1.near_public_key;
  if (key.Ed25519) return key.Ed25519.near_public_key_compressed;
  if (key.Bls12381) return key.Bls12381.public_key;
  return "missing";
}

async function olderEpochNote(running) {
  try {
    const older = await viewCallAt(archivalRpc, "state", {}, PRE_TEE_BLOCK);
    const olderRunning = older.value && older.value.Running;
    if (!olderRunning) {
      return `state() at block ${PRE_TEE_BLOCK} was read from ${archivalRpc} and is not Running. This read does not say whether a share from before the TEE upgrade can still take part in a signature.`;
    }
    const headerAt = await blockHeader(archivalRpc, older.blockHeight);
    const whenMs = headerAt && headerAt.timestampNs ? Number(BigInt(headerAt.timestampNs) / 1000000n) : null;
    if (whenMs !== null && whenMs >= Date.parse("2026-10-23T00:00:00.000Z")) {
      return `state() at block ${older.blockHeight} from ${archivalRpc} is at or after 2026-10-23T00:00:00Z. This read does not say whether a share from before the TEE upgrade can still take part in a signature.`;
    }
    const when = whenMs === null ? "missing" : new Date(whenMs).toISOString();
    const currentKeys = new Map(running.keyset.domains.map((domain) => [domain.domain_id, publicKeyOf(domain.key)]));
    const differing = olderRunning.keyset.domains.filter(
      (domain) => publicKeyOf(domain.key) !== currentKeys.get(domain.domain_id),
    );
    const olderNames = olderRunning.parameters.participants.participants.map((entry) => entry[0]).sort();
    const currentNames = running.parameters.participants.participants.map((entry) => entry[0]).sort();
    const sameParticipants =
      olderNames.length === currentNames.length && olderNames.every((name, index) => name === currentNames[index]);
    const participantSentence = sameParticipants
      ? `The participant accounts are the same ${olderNames.length}.`
      : "The participant accounts differ.";
    const keySentence =
      differing.length === 0
        ? `All ${olderRunning.keyset.domains.length} domain public keys match this read. Resharing can keep the same public key. The same public key does not say that a share from before the TEE upgrade can take part in a current signature.`
        : `Domains ${differing.map((domain) => domain.domain_id).join(", ")} have a different public key. A differing public key means that key changed. A share of the older key is a share of a different key.`;
    return `state() at block ${older.blockHeight} (${when}, hash ${older.blockHash}) was read from ${archivalRpc}. That time is before 2026-10-23T00:00:00Z. That keyset is epoch ${olderRunning.keyset.epoch_id}. ${participantSentence} ${keySentence}`;
  } catch (error) {
    return `state() at block ${PRE_TEE_BLOCK} was not read from ${archivalRpc}: ${error.message}. This read does not say whether a share from before the TEE upgrade can still take part in a signature.`;
  }
}
