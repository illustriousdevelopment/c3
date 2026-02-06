# Signing & Notarization (Local)

macOS builds are signed and notarized locally, not in CI.

## Step 0: Load Credentials

```bash
eval $(op item get "tokimeki/apple-developer/prod" --vault="Development" --format=json | python3 -c "
import sys, json
d = json.load(sys.stdin)
fields = {f['label']: f.get('value','') for f in d.get('fields',[])}
print(f'export APPLE_ID=\"{fields.get(\"apple_id\",\"\")}\"')
print(f'export TEAM_ID=\"{fields.get(\"team_id\",\"\")}\"')
print(f'export APP_PASSWORD=\"{fields.get(\"app_specific_password\",\"\")}\"')
print(f'export SIGNING_IDENTITY=\"{fields.get(\"signing_identity\",\"\")}\"')
")

export VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
export DMG_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/C3_${VERSION}_aarch64.dmg"

echo "Credentials loaded for C3 v${VERSION}"
```

## Step 1: Build

```bash
npm run tauri build -- --target aarch64-apple-darwin
```

## Step 2: Sign & Notarize

```bash
# Sign the app bundle
codesign --deep --force --verify --verbose \
  --sign "$SIGNING_IDENTITY" \
  --options runtime --timestamp \
  src-tauri/target/aarch64-apple-darwin/release/bundle/macos/C3.app

# Re-create the DMG with signed app
rm -f "$DMG_PATH"
bash src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/bundle_dmg.sh \
  --volname "C3" \
  --volicon "src-tauri/icons/icon.icns" \
  --icon-size 72 \
  --window-size 600 400 \
  --icon "C3.app" 180 170 \
  --app-drop-link 420 170 \
  "$DMG_PATH" \
  src-tauri/target/aarch64-apple-darwin/release/bundle/macos

# Notarize
xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APP_PASSWORD" \
  --team-id "$TEAM_ID" \
  --wait

# Staple
xcrun stapler staple "$DMG_PATH"
```

## Step 3: Create GitHub Release

```bash
git tag "v${VERSION}"
git push origin "v${VERSION}"
gh release create "v${VERSION}" "$DMG_PATH" \
  --title "C3 v${VERSION}" \
  --notes "Release notes here"
```

## Step 4: Update Homebrew Tap

After uploading the release, update `illustriousdevelopment/homebrew-c3`:

```bash
SHA=$(shasum -a 256 "$DMG_PATH" | cut -d' ' -f1)
echo "Update Casks/c3.rb with:"
echo "  version \"${VERSION}\""
echo "  sha256 \"${SHA}\""
```
