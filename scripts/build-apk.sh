#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
# Regenerate config-driven names, icons and splash resources on every build.
npx expo prebuild --platform android --no-install
(
  cd android
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
)
node scripts/package-apk.cjs
