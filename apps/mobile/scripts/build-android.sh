#!/usr/bin/env bash
# Builds a signed Storybound APK on this Mac.
#
# The signing key lives outside the project in ~/.storybound/android (keystore.properties points
# at it). Keep a backup: every update must be signed with the same key, or Android will not
# install it over the existing app.
set -euo pipefail

cd "$(dirname "$0")/.."
KEY_DIR="${STORYBOUND_ANDROID_KEY_DIR:-$HOME/.storybound/android}"
PROPERTIES="$KEY_DIR/keystore.properties"
[ -f "$PROPERTIES" ] || { echo "No signing key found at $PROPERTIES" >&2; exit 1; }
read_property() { sed -n "s/^$1=//p" "$PROPERTIES"; }

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
VERSION="$(node -p "require('./app.json').expo.version")"

# The native project is generated from app.json each time and is not kept in git.
npx expo prebuild --platform android --clean --no-install
# Phones from the last several years, the Galaxy S25 Ultra included, and the Mac's Android
# emulator all run 64-bit ARM; building only for it keeps the APK a fraction of the size.
ARCHITECTURES="${STORYBOUND_ANDROID_ARCHITECTURES:-arm64-v8a}"
(cd android && ./gradlew assembleRelease --no-daemon -PreactNativeArchitectures="$ARCHITECTURES")

mkdir -p dist
OUTPUT="dist/storybound-$VERSION.apk"
# Gradle signs release builds with a development key; replace it with the Storybound key.
"$BUILD_TOOLS/apksigner" sign \
  --ks "$(read_property storeFile)" \
  --ks-key-alias "$(read_property keyAlias)" \
  --ks-pass "pass:$(read_property storePassword)" \
  --key-pass "pass:$(read_property keyPassword)" \
  --out "$OUTPUT" \
  android/app/build/outputs/apk/release/app-release.apk
"$BUILD_TOOLS/apksigner" verify "$OUTPUT"
echo "Built $OUTPUT"
