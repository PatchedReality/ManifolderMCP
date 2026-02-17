#!/usr/bin/env bash
#
# Sync MVMF vendor libraries from SceneAssembler and apply Node.js shims.
#
# Usage: ./scripts/sync-vendor.sh [path-to-SceneAssembler]
#        Default source: ../../RP1/SceneAssembler

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC="${1:-$PROJECT_DIR/../../RP1/SceneAssembler}"
SRC_MV="$SRC/site/js/vendor/mv"
DST_MV="$PROJECT_DIR/src/vendor/mv"

if [ ! -d "$SRC_MV" ]; then
  echo "Error: Source directory not found: $SRC_MV"
  exit 1
fi

echo "Syncing from: $SRC_MV"
echo "         to:  $DST_MV"
echo ""

for src_file in "$SRC_MV"/MV*.js; do
  # Skip minified files
  [[ "$src_file" == *.min.js ]] && continue
  file="$(basename "$src_file")"
  dst_file="$DST_MV/$file"

  cp "$src_file" "$dst_file"

  if [ "$file" = "MVMF.js" ]; then
    # MVMF defines MV — export it to globalThis for other modules
    printf '\n// Export MV to globalThis for other modules\nglobalThis.MV = MV;\n' >> "$dst_file"
  else
    # All other files need to import MV from globalThis
    sed -i '' '1s/^/const MV = globalThis.MV;\n/' "$dst_file"
  fi

  if [ "$file" = "MVIO.js" ]; then
    # Allow connections to servers with incomplete SSL cert chains
    sed -i '' "s/transports:    \['websocket'\]/transports:    ['websocket'],\n            rejectUnauthorized: false  \/\/ Allow servers with incomplete SSL cert chains/" "$dst_file"
  fi

  echo "  OK    $file"
done

echo ""

# Print version summary
echo "Versions:"
for dst_file in "$DST_MV"/MV*.js; do
  name="$(basename "${dst_file%.js}")"
  ver=$(grep -oE "'[0-9]+\.[0-9]+\.[0-9]+'" "$dst_file" | head -1 | tr -d "'" || true)
  if [ -n "$ver" ]; then
    echo "  $name $ver"
  fi
done

echo ""
echo "Done. Review changes with: git diff src/vendor/mv/"