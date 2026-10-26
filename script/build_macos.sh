#!/bin/bash
set -euo pipefail
DESK95_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DESK95_ROOT"
DESK95_CONFIGURATION="${DESK95_CONFIGURATION:-debug}"
DESK95_BUNDLE="$DESK95_ROOT/output/macos/Desk95.app"
if [[ ! -d node_modules ]]; then npm ci; fi
npm exec tsc -- -b
npm exec vite -- build --config vite.native.config.ts
node script/native_assets.mjs
if [[ "${DESK95_UNIVERSAL:-0}" == "1" ]]; then
  mkdir -p output/native-binaries
  for desk95_arch in x86_64 arm64; do
    swift build --package-path native --jobs "${DESK95_BUILD_JOBS:-2}" --configuration "$DESK95_CONFIGURATION" --arch "$desk95_arch"
    desk95_arch_bin="$(swift build --package-path native --jobs "${DESK95_BUILD_JOBS:-2}" --configuration "$DESK95_CONFIGURATION" --arch "$desk95_arch" --show-bin-path)/Desk95"
    cp "$desk95_arch_bin" "output/native-binaries/Desk95-$desk95_arch"
  done
  lipo -create output/native-binaries/Desk95-x86_64 output/native-binaries/Desk95-arm64 -output output/native-binaries/Desk95-universal
  DESK95_BIN="$DESK95_ROOT/output/native-binaries/Desk95-universal"
else
  swift build --package-path native --jobs "${DESK95_BUILD_JOBS:-2}" --configuration "$DESK95_CONFIGURATION"
  DESK95_BIN="$(swift build --package-path native --configuration "$DESK95_CONFIGURATION" --show-bin-path)/Desk95"
fi
if [[ -d "$DESK95_BUNDLE" ]]; then
  # Only a verified generated app bundle under this checkout is disposable.
  if [[ "$DESK95_BUNDLE" == "$DESK95_ROOT/output/macos/Desk95.app" && -f "$DESK95_BUNDLE/Contents/Info.plist" ]]; then
    rm -rf -- "$DESK95_BUNDLE"
  else
    echo 'Refusing to replace an unexpected output directory.' >&2; exit 1
  fi
fi
mkdir -p "$DESK95_BUNDLE/Contents/MacOS" "$DESK95_BUNDLE/Contents/Resources"
cp "$DESK95_BIN" "$DESK95_BUNDLE/Contents/MacOS/Desk95"
cp native/Info.plist "$DESK95_BUNDLE/Contents/Info.plist"
cp -R output/native-web "$DESK95_BUNDLE/Contents/Resources/Web"
mkdir -p output/macos/Desk95.iconset
swift script/make_icon.swift output/macos/Desk95_Icon.png
for desk95_size in 16 32 128 256 512; do
  sips -z "$desk95_size" "$desk95_size" output/macos/Desk95_Icon.png --out "output/macos/Desk95.iconset/icon_${desk95_size}x${desk95_size}.png" >/dev/null
  desk95_double=$((desk95_size * 2))
  sips -z "$desk95_double" "$desk95_double" output/macos/Desk95_Icon.png --out "output/macos/Desk95.iconset/icon_${desk95_size}x${desk95_size}@2x.png" >/dev/null
done
iconutil -c icns output/macos/Desk95.iconset -o output/macos/Desk95.icns
cp output/macos/Desk95.icns "$DESK95_BUNDLE/Contents/Resources/Desk95.icns"
if [[ -f THIRD_PARTY_NOTICES.txt ]]; then cp THIRD_PARTY_NOTICES.txt "$DESK95_BUNDLE/Contents/Resources/THIRD_PARTY_NOTICES.txt"; fi
/usr/bin/plutil -lint "$DESK95_BUNDLE/Contents/Info.plist"
DESK95_SIGN_IDENTITY="${DESK95_SIGN_IDENTITY:--}"
if [[ "$DESK95_SIGN_IDENTITY" == "-" ]]; then
  /usr/bin/codesign --force --sign - "$DESK95_BUNDLE"
else
  /usr/bin/codesign --force --options runtime --timestamp --sign "$DESK95_SIGN_IDENTITY" "$DESK95_BUNDLE"
fi
/usr/bin/codesign --verify --deep --strict --verbose=2 "$DESK95_BUNDLE"
echo "$DESK95_BUNDLE"
