# Measure

Measure reads the NEAR Chain Signatures signer contract, `v1.signer`, and says whether each node's on-chain attestation matches the OS measurement that contract publishes.

A row uses three words: `matches`, `does not match`, or `missing`.

## What a row checks

`get_attestation` stores an accepted summary. It does not return the Intel quote. The quote bytes in this report come from the arguments of that account's `submit_participant_info` transaction, as returned by the indexer.

| Column | Source | Comparison |
| --- | --- | --- |
| On-chain attestation | `get_attestation` | MRTD, RTMR0, RTMR1, RTMR2, and `key_provider_event_digest` against `allowed_os_measurements` |
| Quote MRTD, RTMR0–2 | `submit_participant_info` arguments | Those four fields inside a TDX quote v4. The quote has no key-provider digest |
| Quote reportData | bytes 568–631 of that quote | Version `1`, then SHA3-384 of the node's TLS public key concatenated with its account public key, then zeros |
| Image hash | stored attestation | `allowed_docker_image_hashes` |
| Compose hash | stored attestation | `allowed_launcher_compose_hashes` |
| Intel signature | `submit_participant_info` collateral and quote | `@phala/dcap-qvl` `QuoteVerifier.newProd().verify()` |

Quote offsets follow the DCAP quote v4 header (48 bytes, tee type `0x81`) and the Intel TDREPORT 1.0 field order. The fixture test checks that those offsets land on the digests in the same submission's `tcb_info`.

The Intel column is separate from the measurement comparison. `signature checked` means `verify()` returned a report. The library returns that report only after the certificate chain and the signature check pass against Intel's production root. The TCB status is the library's status string (`UpToDate`, `OutOfDate`, and the other statuses it defines) and is printed beside the signature result. Advisory IDs are printed when the library returns them. An advisory ID is not by itself a failure. `signature failed` means `verify()` threw. `signature not checked` means that quote and collateral were not passed to `verify()`.

The key-provider event log is not replayed.

## Snapshot

`node src/cli.js` refreshes `data/report.json` and `web/index.html`. The files in this tree are the read below.

- RPC: `https://rpc.fastnear.com`
- Contract version: `3.17.0`, from `version()`
- TEE verifier: `tee-verifier-2026-08-04.near`, from `tee_verifier_account_id()`
- State block: `222729388`, hash `8KaNc6DYGMuNmRkLsYFGmWfyd4ngFZNCTvjP7LU9pu4T`, time `2026-11-02T14:11:24.544Z`
- Key epoch: `14`, from `state().keyset.epoch_id`
- Current participants: 16. Threshold: 11. Stored TEE accounts: 17
- Published OS measurement sets: 1
- 16 of 16 current participants: the stored attestation matches that measurement
- 16 of 16 current participants: a recovered quote matches on MRTD and RTMR0–2, and its reportData binds that node's keys
- Current participants use 1 image hash and 8 launcher compose hashes. All 16 compose hashes are on the allowlist
- `blacksandtech.near` has a stored attestation and is not in the current participant set. Its image hash is the allowlist entry whose expiry is set. The current participants' image hash has no expiry
- Intel signature, 17 of 17 rows, including `blacksandtech.near`. Each check used the collateral submitted in that row's `submit_participant_info` transaction. Root: Intel production root, via `@phala/dcap-qvl` 0.7.0 `QuoteVerifier.newProd()`. `verify()` returned a report at that row's `accepted_at_seconds` and at that row's current check. Both times the TCB status was `UpToDate` and the advisory ID list was empty. A fresh Intel PCS or Phala PCCS fetch was not used. The current checks ran from `2026-11-02T14:13:08Z` through `2026-11-02T14:14:36Z`
- `svrn-01.near` in this snapshot is transaction `DsxtNkhMo2SECDXusjvJtnotKHAgegAi83W1GfN6aggN`. The fixture test still uses the earlier transaction `8kQuS5VeEg3aDJek7AG2F9QGRuu3Y4gqybZWGWRi9Vhi`

| Account | Quote transaction | Acceptance |
| --- | --- | --- |
| `mpc-lgns.near` | `BMmVXWzUgcCavSAjrRSM13PVRLHSC7R3bVGLEAZNSXJb` | `2026-11-02T14:02:18Z` |
| `multichain-mainnet-aurora.near` | `GXLyeCViNzF5EBp6fGRKeWUwmnC17pJNChcVY6uK3ERQ` | `2026-11-02T13:29:50Z` |
| `near-mpc-staking4all-01.near` | `DBPVCKDJAWBgbet5yJN63pNNTdrahVhmjMYu4wEi3PQZ` | `2026-11-02T13:41:34Z` |
| `nodemonster.near` | `8P38RCTrCvpCJGuym9WyLrMgYuY2z1T6QYsQTnHuUFBm` | `2026-11-02T13:28:47Z` |
| `n1-multichain.near` | `8V4UzkQVmqjm2uBsi2Apv4SWmhZ3BT5fAeUm5wrPVxLa` | `2026-11-02T14:07:10Z` |
| `everstake-mpc-1.near` | `CrtuyXL7xyU6LDUTnB1si3XSdi7xwSQpTNhGNdKK6353` | `2026-11-02T13:13:19Z` |
| `stakin-mpc.near` | `3VFE5QJKPyDZTotW9cS56Wo5eDSXZasQM6EQ5iY6fApe` | `2026-11-02T14:00:25Z` |
| `mpch-01.near` | `4FFxAuiPpriSPicnJ2oFQpjnSdtwkYkrH1KpdjMBw85d` | `2026-11-02T13:16:06Z` |
| `svrn-01.near` | `DsxtNkhMo2SECDXusjvJtnotKHAgegAi83W1GfN6aggN` | `2026-11-02T14:02:10Z` |
| `greenfield-mpc01.near` | `9hkZoV3gT48hNthSHFAidyJ35V65gGECG1aDUpLySVUF` | `2026-11-02T13:18:29Z` |
| `natsai-mpc.near` | `7hDdqpMySphrejKr7YkMj7HYJ81Hhh1Q19rAXLMNuTus` | `2026-11-02T13:49:00Z` |
| `hashkeympc.near` | `42xazEHVk46Fa9pR5Xb8N8EtTdwi8mecfc9uZj7CJMgE` | `2026-11-02T13:27:41Z` |
| `astrostakers-mainnet.near` | `7akyH3xYPh86wxPeCu97Kqa8NomPKACPdDSgvHGZR3Pa` | `2026-11-02T13:57:26Z` |
| `klever-nearmpc-01.near` | `CBzsazMftj2RzER1SypHEphqtfoym8QCuVqr9SKMG1Hr` | `2026-11-02T13:46:48Z` |
| `nansen-ai-mpc.near` | `9oTDYiyHJ289j3LJ95ADxzMydLLC4hBYFBLWs1CyNAF` | `2026-11-02T13:39:28Z` |
| `bitwise-mpc01.near` | `7CgQSwFJUfRkayXaBjS61n5gaKG8ywh2Shg1QRvSh67q` | `2026-11-02T13:18:17Z` |
| `blacksandtech.near` | `G6hH5twjexy3uUuvTHL9UHCTNK41oLxEgk5Hq7cRtqJh` | `2026-11-02T13:41:11Z` |
- `state()` at block `221156250`, hash `AyMFLkKj18uyBhK9cVCgqLPRnGknFzkJsPqgmAGzpXPu`, time `2026-10-22T23:03:03.749Z`, was read from `https://archival-rpc.mainnet.near.org`. That time is before `2026-10-23T00:00:00Z`. The keyset is epoch `14`. All 4 domain public keys match the epoch 14 keys in the current read. The participant accounts are the same 16. Resharing can keep the same public key. The same public key does not say that a share from before the TEE upgrade can take part in a current signature
- `https://rpc.fastnear.com` did not return `state()` at block `210000000`. That node said the block is garbage collected

The page lists the block height and block hash of each view call.

## Library limit

The signature check uses `@phala/dcap-qvl` 0.7.0. That package depends on `elliptic` 6.6.1. `npm audit` reports 2 low findings, both from `elliptic`: "Elliptic Uses a Cryptographic Primitive with a Risky Implementation". Measure calls the library. It does not ship a replacement verifier.

`node src/cli.js` runs the same on-chain check for every recovered quote. If the on-chain collateral fails at the current time, the command then tries collateral fetched from Intel PCS (`https://api.trustedservices.intel.com`) and, if that does not return a report, from Phala PCCS (`https://pccs.phala.network`). The page names that source. A fetched check does not erase a failure of the submitted collateral.

## Run

Node 22. No key.

```
npm install
node --test
node src/cli.js
```

Then open `web/index.html`.

`MEASURE_RPC` overrides the RPC URL. `MEASURE_INDEXER` overrides the indexer origin. The default indexer is `https://api.nearblocks.io`. `MEASURE_ARCHIVAL_RPC` overrides the archival URL used for the pre-TEE `state()` read. `MEASURE_PRE_TEE_BLOCK` overrides that block height.

## Tests

`fixtures/svrn-01.submit.json` is the public arguments of transaction `8kQuS5VeEg3aDJek7AG2F9QGRuu3Y4gqybZWGWRi9Vhi`, predecessor `svrn-01.near`. One test flips a single MRTD byte and expects `does not match`. One test runs `verify()` on that fixture at acceptance and at unix `1793627763`, and expects `signature checked` with TCB `UpToDate`. One test flips a collateral signature byte and expects `signature failed` with no TCB status. The page test expects the word verified to be absent.

## Trust boundary

Measure is read-only. It does not sign, spend, or hold a key. Responses from the RPC and the indexer are data. An account id is checked against `^[a-z0-9._-]+$` before it is placed in an indexer URL. The page escapes text it prints.
