#!/bin/bash
# Build script: minifies JS, copies static files into dist/, zips it up.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SRC_DIR/../zetacoach-dist"
ZIP_PATH="$SRC_DIR/../zetacoach.zip"

echo "Cleaning $DIST_DIR..."
rm -rf "$DIST_DIR" "$ZIP_PATH"
mkdir -p "$DIST_DIR/zetacoach"

# Copy non-JS files verbatim
echo "Copying static files..."
cp -R "$SRC_DIR/icons"       "$DIST_DIR/zetacoach/"
cp    "$SRC_DIR/manifest.json"  "$DIST_DIR/zetacoach/"
cp    "$SRC_DIR/dashboard.html" "$DIST_DIR/zetacoach/"
cp    "$SRC_DIR/dashboard.css"  "$DIST_DIR/zetacoach/"
cp    "$SRC_DIR/popup.html"     "$DIST_DIR/zetacoach/"
cp    "$SRC_DIR/popup.css"      "$DIST_DIR/zetacoach/"

# Minify each JS file with terser
echo "Minifying JS..."
for f in analytics.js background.js content.js dashboard.js popup.js tiers.js; do
  echo "  $f"
  npx -y terser "$SRC_DIR/$f" \
    --compress \
    --mangle \
    --output "$DIST_DIR/zetacoach/$f"
done

echo "Zipping..."
cd "$DIST_DIR"
zip -rq "$ZIP_PATH" zetacoach -x "*.DS_Store"

echo ""
echo "Done."
echo "  Built: $DIST_DIR/zetacoach/"
echo "  Zip:   $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"
