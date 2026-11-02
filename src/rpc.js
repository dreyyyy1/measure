const ACCOUNT = "v1.signer";
const ACCOUNT_PATTERN = /^[a-z0-9._-]+$/;

export async function viewCall(rpcUrl, method, args, timeoutMs = 30000) {
  return callFunction(rpcUrl, method, args, { finality: "final" }, timeoutMs);
}

export async function viewCallAt(rpcUrl, method, args, blockId, timeoutMs = 30000) {
  return callFunction(rpcUrl, method, args, { block_id: blockId }, timeoutMs);
}

async function callFunction(rpcUrl, method, args, position, timeoutMs) {
  const argsBase64 = Buffer.from(JSON.stringify(args ?? {})).toString("base64");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "measure",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: ACCOUNT,
        method_name: method,
        args_base64: argsBase64,
        ...position,
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.error) {
    const detail = typeof body.error.data === "string" ? body.error.data : body.error.message;
    throw new Error(`${method} ${detail || "rpc error"}`);
  }
  const text = Buffer.from(body.result.result).toString("utf8");
  return {
    method,
    account: ACCOUNT,
    blockHeight: body.result.block_height,
    blockHash: body.result.block_hash,
    value: JSON.parse(text),
  };
}

export async function blockHeader(rpcUrl, blockId, timeoutMs = 30000) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "measure",
      method: "block",
      params: { block_id: blockId },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  const body = await response.json();
  const header = body.result && body.result.header;
  if (!header) return null;
  return {
    height: header.height,
    hash: header.hash,
    timestampNs: header.timestamp_nanosec ?? header.timestamp,
  };
}

export async function latestSubmission(indexerUrl, accountId, timeoutMs = 45000) {
  if (!ACCOUNT_PATTERN.test(accountId)) {
    return { found: false, reason: "account id was rejected before the indexer request" };
  }
  let cursor = "";
  for (let page = 0; page < 2; page += 1) {
    const url = new URL(`/v1/account/${encodeURIComponent(accountId)}/txns`, indexerUrl);
    url.searchParams.set("method", "submit_participant_info");
    url.searchParams.set("per_page", "5");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchIndexer(url, timeoutMs);
    if (response.error) {
      return { found: false, reason: `indexer request failed: ${response.error}` };
    }
    if (!response.ok) {
      return { found: false, reason: `indexer HTTP ${response.status}` };
    }
    const body = await response.json();
    for (const tx of body.txns || []) {
      if (tx.predecessor_account_id !== accountId) continue;
      for (const action of tx.actions || []) {
        if (action.method !== "submit_participant_info") continue;
        const args = parseArgs(action.args);
        if (!args) {
          return {
            found: false,
            txHash: tx.transaction_hash,
            reason: "submit_participant_info arguments were not JSON",
          };
        }
        return {
          found: true,
          txHash: tx.transaction_hash,
          blockHeight: tx.block && tx.block.block_height,
          blockTimestampNs: tx.block_timestamp,
          args,
        };
      }
    }
    if (!body.cursor || body.cursor === cursor) break;
    cursor = body.cursor;
  }
  return { found: false, reason: "no submit_participant_info in the filtered indexer pages that were scanned" };
}

async function fetchIndexer(url, timeoutMs) {
  let lastError = "indexer request failed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        await delay(1000 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error.message;
      await delay(1000 * (attempt + 1));
    }
  }
  return { error: lastError };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args) {
  if (args && typeof args === "object") return args;
  if (typeof args !== "string" || args.length === 0) return null;
  try {
    return JSON.parse(args);
  } catch {
    return null;
  }
}
