#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Builds the distribution: the Dashboards platform, the plugins that distribution/plugins.json
# ships, and the two put together as one tarball.
#
#   distribution/scripts/build.sh platform          target/opensearch-dashboards-<version>-linux-<arch>.tar.gz
#   distribution/scripts/build.sh plugin <name>     target/plugins/<name>-<version>.zip
#   distribution/scripts/build.sh plugins           every plugin, one after another
#   distribution/scripts/build.sh assemble          target/infradashboard-<version>-linux-<arch>.tar.gz
#   distribution/scripts/build.sh all               platform, plugins, assemble
#
# Build the platform first: its build clears target/. ARCH is x64 (default) or arm64. Set
# ALLOW_ROOT=1 where the build runs as root (a container).
# A plugin is built on its own, with only that plugin under plugins/, the way the upstream release
# builds them: each brings its own dependencies and they are not all installable side by side.
# CI builds them in parallel (.github/workflows/distribution.yml).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
ARCH="${ARCH:-x64}"
TARGET="$ROOT/target"
PLATFORM_TARBALL="$TARGET/opensearch-dashboards-$VERSION-linux-$ARCH.tar.gz"
DIST_NAME="infradashboard-$VERSION-linux-$ARCH"

case "$ARCH" in
  x64) PLATFORM_FLAG=--linux ;;
  arm64) PLATFORM_FLAG=--linux-arm ;;
  *) echo "ARCH must be x64 or arm64, not '$ARCH'" >&2; exit 1 ;;
esac

# the bootstrap and the two build commands below are the ones the upstream release runs
bootstrap() {
  yarn osd bootstrap
}

build_platform() {
  bootstrap
  yarn build-platform "$PLATFORM_FLAG" --skip-os-packages --release
  ls -lh "$PLATFORM_TARBALL"
}

build_plugin() {
  local name="$1"
  # only this plugin may be under plugins/ while it builds
  local other
  for other in plugins/*/; do
    [ -d "$other" ] || continue
    if [ "$(basename "$other")" != "$name" ]; then
      echo "plugins/$(basename "$other") is in the way: a plugin builds with only itself under plugins/." >&2
      exit 1
    fi
  done

  node distribution/scripts/fetch_plugins.js "$name"
  bootstrap
  # a plugin names its build helper plugin_helpers or plugin-helpers
  local helper
  helper="$(node -p "require('./plugins/$name/package.json').scripts.plugin_helpers ? 'plugin_helpers' : 'plugin-helpers'")"
  (cd "plugins/$name" && yarn "$helper" build --opensearch-dashboards-version="$VERSION")

  mkdir -p "$TARGET/plugins"
  cp "plugins/$name"/build/*.zip "$TARGET/plugins/"
  ls -lh "$TARGET/plugins" | grep -i "$name" || true
}

build_plugins() {
  local name
  for name in $(node distribution/scripts/fetch_plugins.js --list); do
    build_plugin "$name"
    rm -rf "plugins/$name"
  done
}

assemble() {
  [ -f "$PLATFORM_TARBALL" ] || { echo "Missing $PLATFORM_TARBALL: run '$0 platform' first." >&2; exit 1; }

  local dist="$TARGET/$DIST_NAME"
  rm -rf "$dist"
  mkdir -p "$dist"
  tar -xzf "$PLATFORM_TARBALL" -C "$dist" --strip-components=1

  # Only the plugins the manifest ships: a zip an earlier build left in target/plugins stays out.
  local name zip
  for name in $(node distribution/scripts/fetch_plugins.js --list); do
    zip="$(ls "$TARGET/plugins/$name"-*.zip 2>/dev/null | head -n 1)"
    [ -n "$zip" ] || { echo "No zip for $name in target/plugins: run '$0 plugin $name' first." >&2; exit 1; }
    echo "Installing $(basename "$zip")"
    "$dist/bin/opensearch-dashboards-plugin" install "file://$zip" ${ALLOW_ROOT:+--allow-root}
  done

  # the defaults of the distribution; a deployment mounts its own file over this one
  cp distribution/config/opensearch_dashboards.yml "$dist/config/opensearch_dashboards.yml"

  tar -czf "$TARGET/$DIST_NAME.tar.gz" -C "$TARGET" "$DIST_NAME"
  ls -lh "$TARGET/$DIST_NAME.tar.gz"
}

case "${1:-}" in
  platform) build_platform ;;
  plugin) [ -n "${2:-}" ] || { echo "Which plugin? See: node distribution/scripts/fetch_plugins.js --list" >&2; exit 1; }; build_plugin "$2" ;;
  plugins) build_plugins ;;
  assemble) assemble ;;
  all) build_platform; build_plugins; assemble ;;
  *) sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
