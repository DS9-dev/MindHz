# Updates — current policy and future design

**Today MindHz contains no auto-update mechanism and never contacts the network.** Users update by downloading a new release; installed versions keep their data in `%APPDATA%\MindHz`, portable versions in `MindHz-Data`.

## Prepared architecture

- Releases are produced only by the tag-driven workflow, with a strict tag ↔ `package.json` version check and SHA-256 checksums — the same artefacts an updater would consume.
- Data files are versioned (`version` fields in `settings.json` / `library.json`) and always pass through sanitisers, so newer/older versions read each other's data safely.
- The NSIS installer is per-user (no elevation), installs over existing versions and keeps user data.

## Requirements before enabling auto-updates

An updater will only be added when all of the following are in place:

1. **Authenticity:** signed binaries (Authenticode) and a signed update manifest; the app verifies the signature with a pinned public key before installing.
2. **Integrity:** SHA-512 of every artefact in the manifest, checked after download.
3. **Source:** downloads only from `https://github.com/DS9-dev/MindHz/releases` over HTTPS; no redirects to other hosts.
4. **Version safety:** semantic-version comparison with downgrade protection; pre-releases only when the user opts in.
5. **Consent:** update checks are opt-in, can be disabled, and nothing is installed without the user's confirmation. The portable edition only notifies.

`electron-updater` with a GitHub provider satisfies items 2–5 out of the box once signing (item 1) is configured.
