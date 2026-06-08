# Release Process

This app must be signed, notarized, and stapled before uploading a DMG to GitHub.
An unsigned or unstapled DMG can appear as "damaged" or "corrupt" on another Mac.

## macOS Signing

Use the Developer ID Application certificate for the Apple team:

```text
Developer ID Application: illustrious development, llc (4VK28V5GUS)
```

Build the release DMG with the signing identity injected into Tauri:

```bash
bash -c 'export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && npm run tauri build -- --bundles dmg --config "{\"bundle\":{\"macOS\":{\"signingIdentity\":\"Developer ID Application: illustrious development, llc (4VK28V5GUS)\"}}}"'
```

Expected output includes signing for both `C3.app` and `C3_*.dmg`.

## Notarization

The local keychain profile used for notarization is:

```text
c3-notary
```

If that profile is missing, create it with an Apple ID, app-specific password, and team ID:

```bash
xcrun notarytool store-credentials c3-notary \
  --apple-id "APPLE_ID" \
  --team-id "4VK28V5GUS" \
  --password "APP_SPECIFIC_PASSWORD"
```

Submit the DMG and wait for Apple's response:

```bash
xcrun notarytool submit src-tauri/target/release/bundle/dmg/C3_0.2.10_aarch64.dmg \
  --keychain-profile c3-notary \
  --wait
```

Staple the notarization ticket:

```bash
xcrun stapler staple src-tauri/target/release/bundle/dmg/C3_0.2.10_aarch64.dmg
```

## Verification

Verify the stapled ticket:

```bash
xcrun stapler validate src-tauri/target/release/bundle/dmg/C3_0.2.10_aarch64.dmg
```

Verify Gatekeeper acceptance:

```bash
spctl -a -vvv -t install src-tauri/target/release/bundle/dmg/C3_0.2.10_aarch64.dmg
```

The Gatekeeper check must report:

```text
accepted
source=Notarized Developer ID
```

Confirm the DMG signature details:

```bash
codesign -dv --verbose=4 src-tauri/target/release/bundle/dmg/C3_0.2.10_aarch64.dmg
```

Expected details include:

```text
Authority=Developer ID Application: illustrious development, llc (4VK28V5GUS)
TeamIdentifier=4VK28V5GUS
Notarization Ticket=stapled
```

## Upload

Replace the GitHub release asset only after the DMG passes verification:

```bash
gh release upload v0.2.10 src-tauri/target/release/bundle/dmg/C3_0.2.10_aarch64.dmg --clobber
```

Verify the release asset:

```bash
gh release view v0.2.10 --json url,assets --jq '.url, (.assets[] | select(.name=="C3_0.2.10_aarch64.dmg") | {name,url,size: .size})'
```

## In-App Update Indicator

C3 checks GitHub's latest release endpoint:

```text
https://api.github.com/repos/illustriousdevelopment/c3/releases/latest
```

The update indicator compares the installed app version to the latest release tag, then opens the first matching DMG asset when clicked. Keep the release tag and DMG asset name aligned with the app version:

```text
v0.2.10
C3_0.2.10_aarch64.dmg
```

After publishing a release, the newest GitHub release must contain a notarized `.dmg` asset or the in-app update button will fall back to the release page.

When bumping versions, update the version string in `package.json`, `src-tauri/tauri.conf.json`, and these command examples.
