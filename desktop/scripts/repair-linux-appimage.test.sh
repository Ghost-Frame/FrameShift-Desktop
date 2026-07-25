#!/usr/bin/env bash
# Exercises AppImage repair selection, library quarantine, AppRun patching, and
# fail-closed cardinality checks without invoking the real packaging tool.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repair_script="$script_dir/repair-linux-appimage.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/frameshift-appimage-test.XXXXXX")"

plugin="$test_root/linuxdeploy-plugin-appimage.AppImage"
cat > "$plugin" <<'PLUGIN'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p squashfs-root/usr/bin
cat > squashfs-root/usr/bin/appimagetool <<'TOOL'
#!/usr/bin/env bash
set -euo pipefail
printf 'repacked:%s\n' "$1" > "$2"
TOOL
chmod +x squashfs-root/usr/bin/appimagetool
PLUGIN
chmod +x "$plugin"

valid_bundle="$test_root/valid/bundle/appimage"
app_dir="$valid_bundle/FrameShift.AppDir"
mkdir -p "$app_dir/usr/lib/x86_64-linux-gnu" "$valid_bundle"
printf 'glib\n' > "$app_dir/usr/lib/libglib-2.0.so.0"
printf 'systemd\n' > "$app_dir/usr/lib/libsystemd.so.0"
printf 'wayland\n' > "$app_dir/usr/lib/x86_64-linux-gnu/libwayland-client.so.0"
printf 'keep\n' > "$app_dir/usr/lib/libwebkit2gtk-4.1.so.0"
cat > "$app_dir/AppRun" <<'APP_RUN'
#!/usr/bin/env bash
source "$(dirname "$0")/apprun-hooks/linuxdeploy-plugin-gtk.sh"
exec "$(dirname "$0")/AppRun.wrapped" "$@"
APP_RUN
chmod +x "$app_dir/AppRun"
printf 'old image\n' > "$valid_bundle/FrameShift.AppImage"

APPIMAGETOOL_PLUGIN="$plugin" RUNNER_TEMP="$test_root" "$repair_script" "$valid_bundle"
grep -q '^repacked:' "$valid_bundle/FrameShift.AppImage"
grep -q 'FRAMESHIFT_HOST_GSTREAMER' "$app_dir/AppRun"
test ! -e "$app_dir/usr/lib/libglib-2.0.so.0"
test ! -e "$app_dir/usr/lib/libsystemd.so.0"
test ! -e "$app_dir/usr/lib/x86_64-linux-gnu/libwayland-client.so.0"
test -e "$app_dir/usr/lib/libwebkit2gtk-4.1.so.0"
test "$(find "$test_root" -path '*/frameshift-appimage-libs.*/usr/lib/libglib-2.0.so.0' | wc -l)" -eq 1

missing_bundle="$test_root/missing"
mkdir -p "$missing_bundle"
if APPIMAGETOOL_PLUGIN="$plugin" RUNNER_TEMP="$test_root" "$repair_script" "$missing_bundle" 2>"$test_root/missing.err"; then
  echo "ERROR: repair unexpectedly accepted a bundle without an AppDir or AppImage" >&2
  exit 1
fi
grep -q 'expected exactly one AppDir' "$test_root/missing.err"

multiple_bundle="$test_root/multiple"
mkdir -p "$multiple_bundle/One.AppDir" "$multiple_bundle/Two.AppDir"
printf 'image\n' > "$multiple_bundle/FrameShift.AppImage"
if APPIMAGETOOL_PLUGIN="$plugin" RUNNER_TEMP="$test_root" "$repair_script" "$multiple_bundle" 2>"$test_root/multiple.err"; then
  echo "ERROR: repair unexpectedly accepted multiple AppDirs" >&2
  exit 1
fi
grep -q 'expected exactly one AppDir.*found 2' "$test_root/multiple.err"

multiple_images_bundle="$test_root/multiple-images"
multiple_images_app_dir="$multiple_images_bundle/FrameShift.AppDir"
mkdir -p "$multiple_images_app_dir/usr/lib"
printf 'glib\n' > "$multiple_images_app_dir/usr/lib/libglib-2.0.so.0"
printf '#!/usr/bin/env bash\nexec true\n' > "$multiple_images_app_dir/AppRun"
printf 'image one\n' > "$multiple_images_bundle/FrameShift-one.AppImage"
printf 'image two\n' > "$multiple_images_bundle/FrameShift-two.AppImage"
if APPIMAGETOOL_PLUGIN="$plugin" RUNNER_TEMP="$test_root" "$repair_script" "$multiple_images_bundle" 2>"$test_root/multiple-images.err"; then
  echo "ERROR: repair unexpectedly accepted multiple AppImages" >&2
  exit 1
fi
grep -q 'expected exactly one AppImage.*found 2' "$test_root/multiple-images.err"

echo "AppImage repair tests passed; fixtures retained at $test_root"
