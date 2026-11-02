export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function cell(status, note) {
  const kind = status === "matches" ? "match" : status === "missing" ? "gap" : "bad";
  const extra = note ? `<div class="sub">${escapeHtml(note)}</div>` : "";
  return `<td class="${kind}">${escapeHtml(status)}${extra}</td>`;
}

function shortHash(hash) {
  return typeof hash === "string" && hash.length > 0 ? hash.slice(0, 12) : "";
}

function imageNote(image, hash) {
  const prefix = shortHash(hash);
  if (!image || image.status !== "matches") return prefix;
  const expiry =
    typeof image.expiryTimestampSeconds === "number"
      ? `allowlist expiry ${when(image.expiryTimestampSeconds)}`
      : "allowlist expiry none";
  return [prefix, expiry].filter(Boolean).join(" · ");
}

function varietySentence(rows) {
  const current = rows.filter((row) => row.participantId !== null);
  const imageHashes = new Set(current.map((row) => row.stored.mpcImageHash).filter(Boolean));
  const composeHashes = new Set(current.map((row) => row.stored.launcherComposeHash).filter(Boolean));
  const composeMatches = current.filter((row) => row.compose.status === "matches").length;
  const outsideExpiry = rows.filter(
    (row) => row.participantId === null && typeof row.image.expiryTimestampSeconds === "number",
  ).length;
  return `Current participants use ${imageHashes.size} image hash and ${composeHashes.size} launcher compose hashes. ${composeMatches} of ${current.length} compose hashes are on the allowlist. ${outsideExpiry} stored account outside the participant set has an allowlist expiry.`;
}

function signatureSentence(rows) {
  const checked = rows.filter((row) => signatureChecked(row.signature)).length;
  const failed = rows.filter((row) => signatureFailed(row.signature)).length;
  const pending = rows.length - checked - failed;
  return `${checked} of ${rows.length} rows were passed to the Intel signature check and the check returned a report. ${failed} of ${rows.length} failed that check. ${pending} of ${rows.length} say signature not checked.`;
}

function signatureChecked(signature) {
  return signature && signature.acceptance && signature.acceptance.status === "signature checked" && signature.now && signature.now.status === "signature checked";
}

function signatureFailed(signature) {
  if (!signature || !signature.acceptance || !signature.now) return false;
  return signature.acceptance.status === "signature failed" || signature.now.status === "signature failed";
}

function signatureCell(signature) {
  if (!signature || !signature.acceptance || !signature.now) {
    return `<td class="gap">signature not checked</td>`;
  }
  if (
    signature.acceptance.status === "signature not checked" &&
    signature.now.status === "signature not checked"
  ) {
    const reason = signature.acceptance.reason
      ? `<div class="sub">${escapeHtml(signature.acceptance.reason)}</div>`
      : "";
    return `<td class="gap">signature not checked${reason}</td>`;
  }
  const kind = signatureChecked(signature) ? "match" : signatureFailed(signature) ? "bad" : "gap";
  const lines = [
    signatureLine(signature.acceptance, "at acceptance"),
    signatureLine(signature.now, "at the current check"),
  ];
  const source = signature.collateralSource
    ? `<div class="sub">${escapeHtml(`${signature.collateralSource}. ${signature.root}. ${signature.library} ${signature.libraryVersion}`)}</div>`
    : "";
  const fresh = Array.isArray(signature.fresh)
    ? signature.fresh
        .map((item) => {
          const tcb = item.tcbStatus ? `TCB ${item.tcbStatus}` : item.reason || "missing";
          return `<div class="sub">${escapeHtml(`fresh collateral from ${item.source}: ${item.status}. ${tcb}`)}</div>`;
        })
        .join("")
    : "";
  return `<td class="${kind}">${lines.join("<br>")}${source}${fresh}</td>`;
}

function signatureLine(point, label) {
  const tcb = point.tcbStatus ? `TCB ${point.tcbStatus}` : point.reason || "missing";
  const advisories = Array.isArray(point.advisoryIds) && point.advisoryIds.length > 0 ? `. advisories ${point.advisoryIds.join(", ")}` : "";
  return escapeHtml(`${point.status} ${label} ${when(point.checkedAtSeconds)}. ${tcb}${advisories}`);
}

function when(seconds) {
  if (typeof seconds !== "number") return "missing";
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

function ns(value) {
  if (typeof value !== "string" && typeof value !== "number") return "missing";
  const millis = Number(BigInt(value) / 1000000n);
  return new Date(millis).toISOString().replace(".000Z", "Z");
}

export function renderPage(report) {
  const rows = report.rows
    .map((row) => {
      const role = row.participantId === null ? "stored, not a current participant" : `participant ${row.participantId}`;
      return `<tr>
        <td><code>${escapeHtml(row.accountId)}</code><div class="sub">${escapeHtml(role)}</div></td>
        ${cell(row.stored.status, row.stored.reason)}
        ${cell(row.quote.status, row.quote.reason)}
        <td>${escapeHtml(row.quote.binding)}</td>
        ${cell(row.image.status, imageNote(row.image, row.stored.mpcImageHash))}
        ${cell(row.compose.status, shortHash(row.stored.launcherComposeHash))}
        ${signatureCell(row.signature)}
        <td>${escapeHtml(when(row.stored.acceptedAtSeconds))}<div class="sub">expires ${escapeHtml(when(row.stored.expiryTimestampSeconds))}</div></td>
        <td>${row.submissionTx ? `<code>${escapeHtml(row.submissionTx)}</code>` : "missing"}</td>
      </tr>`;
    })
    .join("\n");

  const calls = report.calls
    .map(
      (call) =>
        `<tr><td><code>${escapeHtml(call.method)}</code></td><td>${escapeHtml(call.blockHeight)}</td><td><code>${escapeHtml(call.blockHash)}</code></td></tr>`,
    )
    .join("\n");

  const allowed = report.allowedMeasurements
    .map(
      (row) =>
        `<li><code>mrtd</code> ${escapeHtml(row.mrtd)}<br><code>rtmr0</code> ${escapeHtml(row.rtmr0)}<br><code>rtmr1</code> ${escapeHtml(row.rtmr1)}<br><code>rtmr2</code> ${escapeHtml(row.rtmr2)}<br><code>key_provider_event_digest</code> ${escapeHtml(row.key_provider_event_digest)}</li>`,
    )
    .join("\n");

  const domains = report.domains
    .map(
      (domain) =>
        `<li>domain ${escapeHtml(domain.id)} ${escapeHtml(domain.protocol)} ${escapeHtml(domain.purpose)}, threshold ${escapeHtml(domain.threshold)}, attempt ${escapeHtml(domain.attempt)}, key <code>${escapeHtml(domain.publicKey)}</code></li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Measure</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f7f4ee; color: #1a1814; font: 16px/1.45 "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 40px 20px 80px; }
    h1 { font: 48px/1 "Iowan Old Style", Palatino, Georgia, serif; margin: 0 0 12px; }
    h2 { font: 22px/1.2 "Iowan Old Style", Palatino, Georgia, serif; margin: 36px 0 8px; }
    p, li { max-width: 78ch; }
    .kicker { letter-spacing: 0.04em; text-transform: uppercase; font-size: 12px; margin: 0; }
    table { width: 100%; border-collapse: collapse; background: #fffdf8; margin-top: 12px; }
    th, td { border-bottom: 1px solid #ddd6c8; text-align: left; vertical-align: top; padding: 8px; font-size: 14px; }
    th { font-size: 12px; letter-spacing: 0.03em; text-transform: uppercase; }
    code { font-family: Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .sub { color: #5c564c; font-size: 12px; margin-top: 4px; }
    td.match { color: #1a1814; }
    td.bad { background: #f3e4e1; }
    td.gap { background: #eeeae2; }
    .count { font-size: 18px; }
  </style>
</head>
<body>
<main>
  <p class="kicker">NEAR Chain Signatures · v1.signer</p>
  <h1>Measure</h1>
  <p>${escapeHtml(report.summary)}</p>
  <p class="count">${escapeHtml(report.counts.sentence)}</p>

  <h2>This read</h2>
  <p>Contract <code>v1.signer</code> version <code>${escapeHtml(report.version)}</code>. TEE verifier <code>${escapeHtml(report.teeVerifier)}</code>. RPC <code>${escapeHtml(report.rpc)}</code>. State block <code>${escapeHtml(report.stateBlock.height)}</code> at ${escapeHtml(ns(report.stateBlock.timestampNs))}, hash <code>${escapeHtml(report.stateBlock.hash)}</code>.</p>
  <p>Key epoch <code>${escapeHtml(report.epochId)}</code> from <code>state().keyset.epoch_id</code>. Current participants <code>${escapeHtml(report.participantCount)}</code>. Signature threshold <code>${escapeHtml(report.threshold)}</code>. Attestation storage window <code>${escapeHtml(report.teeUpgradeDeadlineSeconds)}</code> seconds, from <code>config().tee_upgrade_deadline_duration_seconds</code>.</p>

  <h2>Signers</h2>
  <table>
    <thead>
      <tr>
        <th>Account</th>
        <th>On-chain attestation</th>
        <th>Quote MRTD, RTMR0–2</th>
        <th>Quote reportData</th>
        <th>Image hash</th>
        <th>Compose hash</th>
        <th>Intel signature</th>
        <th>Accepted</th>
        <th>Quote transaction</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p>${escapeHtml(varietySentence(report.rows))}</p>
  <p>On-chain attestation compares the five fields stored by <code>get_attestation</code> with <code>allowed_os_measurements</code>. The quote column compares only MRTD and RTMR0–2, because the quote body has no key-provider digest. <code>get_attestation</code> does not return quote bytes. Quote bytes are taken from <code>submit_participant_info</code> arguments on the indexer.</p>
  <p>${escapeHtml(signatureSentence(report.rows))}</p>

  <h2>Key epoch</h2>
  <p>The shares named by this read belong to key epoch ${escapeHtml(report.epochId)}. ${escapeHtml(report.olderEpoch)}</p>
  <ul>
    ${domains}
  </ul>

  <h2>Published OS measurements</h2>
  <ul>
    ${allowed}
  </ul>

  <h2>Where each number was read</h2>
  <table>
    <thead><tr><th>Method on v1.signer</th><th>Block</th><th>Block hash</th></tr></thead>
    <tbody>
      ${calls}
    </tbody>
  </table>
  <p>Indexer for quote transactions: <code>${escapeHtml(report.indexer)}</code>, account transaction list, method <code>submit_participant_info</code>.</p>

  <h2>Limits of this read</h2>
  <ul>
    <li>Intel's signature is checked only on a row that names a TCB status. Other rows say signature not checked. A measurement match does not check the signature.</li>
    <li>The key-provider event log is not replayed. That digest is compared only as stored.</li>
    <li>RTMR3 is parsed from the quote and is not an allowlist field.</li>
    <li>${escapeHtml(report.olderEpoch)}</li>
  </ul>
  <p>Read-only. Measure does not sign, spend, or hold a key.</p>
</main>
</body>
</html>
`;
}
