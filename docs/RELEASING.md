# Releasing MindHz

1. Update `version` in `package.json` (semantic versioning, e.g. `0.2.0`; a suffix such as `0.2.0-beta.1` publishes a pre-release).
2. Add a `## [0.2.0] — YYYY-MM-DD` section to `CHANGELOG.md`.
3. Commit and push to `main`:
   ```bash
   git commit -am "Release 0.2.0" && git push
   ```
   (Pushing a tag `v0.2.0` works too.)

The **Release** workflow (`.github/workflows/release.yml`) then checks whether release `v0.2.0` already exists; if not, it runs on a clean `windows-latest` machine:

1. checks that a pushed tag (if any) equals the `package.json` version;
2. `npm ci` (locked dependencies), typecheck, unit tests;
3. builds `MindHz-Setup-<v>.exe` (NSIS) and `MindHz-Portable-<v>.zip`;
4. smoke-tests the unpacked app, a fresh extraction of the portable ZIP (incl. data stored in `MindHz-Data`), and the installer (silent install → run → silent uninstall);
5. writes `SHA256SUMS.txt`;
6. creates the tag and publishes a GitHub Release with the two files, checksums and notes from `CHANGELOG.md`.

Only the built-in, short-lived `GITHUB_TOKEN` is used; no secrets are stored in the repository.

## Code signing

Builds are currently unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`), so Windows SmartScreen shows a warning for new downloads. To sign later, obtain a code-signing certificate (or use a service such as Azure Trusted Signing / SignPath for open-source projects), add it as repository secrets and configure `win.signtoolOptions` / `CSC_LINK` + `CSC_KEY_PASSWORD` in electron-builder. Never commit certificates.

## Local Windows build

```powershell
npm ci
npm run dist:win     # release\MindHz-Setup-<v>.exe and release\MindHz-Portable-<v>.zip
npm run checksums
npm run smoke -- --exe release\win-unpacked\MindHz.exe
```
