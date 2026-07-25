#!/usr/bin/env bash
# Repairs Tauri AppImages that bundle host-infrastructure libraries incompatible
# with newer Mesa/WebKit stacks, then atomically repacks the portable artifact.

set -euo pipefail

bundle_dir="${1:?usage: repair-linux-appimage.sh <tauri-bundle-dir>}"
appimagetool_plugin="${APPIMAGETOOL_PLUGIN:-$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage}"
work_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

mapfile -d '' app_dirs < <(find "$bundle_dir" -type d -name '*.AppDir' -print0)
mapfile -d '' app_images < <(find "$bundle_dir" -type f -name '*.AppImage' -print0)

if [[ "${#app_dirs[@]}" -ne 1 ]]; then
  echo "ERROR: expected exactly one AppDir under $bundle_dir; found ${#app_dirs[@]}" >&2
  exit 1
fi
if [[ "${#app_images[@]}" -ne 1 ]]; then
  echo "ERROR: expected exactly one AppImage under $bundle_dir; found ${#app_images[@]}" >&2
  exit 1
fi
if [[ ! -x "$appimagetool_plugin" ]]; then
  echo "ERROR: linuxdeploy AppImage plugin is missing or not executable: $appimagetool_plugin" >&2
  exit 1
fi

app_dir="${app_dirs[0]}"
app_image="${app_images[0]}"
quarantine_dir="$(mktemp -d "$work_root/frameshift-appimage-libs.XXXXXX")"
tool_dir="$(mktemp -d "$work_root/frameshift-appimagetool.XXXXXX")"
repack_dir="$(mktemp -d "$work_root/frameshift-repacked.XXXXXX")"
repacked_image="$repack_dir/FrameShift.AppImage"

# Preserve every excluded library outside the AppDir so the repair is auditable
# and never destroys the build output while it is being transformed.
mapfile -d '' incompatible_libraries < <(
  find "$app_dir/usr/lib" -maxdepth 3 \( -type f -o -type l \) \( \
    -name 'libwayland-*.so*' -o \
    -name 'libglib-2.0.so*' -o \
    -name 'libgio-2.0.so*' -o \
    -name 'libgobject-2.0.so*' -o \
    -name 'libgmodule-2.0.so*' -o \
    -name 'libgst*.so*' -o \
    -name 'libmount.so*' -o \
    -name 'libblkid.so*' -o \
    -name 'libsystemd.so*' -o \
    -name 'libudev.so*' -o \
    -name 'libselinux.so*' -o \
    -name 'libpcre2-8.so*' -o \
    -name 'libzstd.so*' -o \
    -name 'libelf.so*' -o \
    -name 'libffi.so*' \
  \) -print0
)

if [[ "${#incompatible_libraries[@]}" -eq 0 ]]; then
  echo "ERROR: no known incompatible libraries were found; review whether this repair is still required" >&2
  exit 1
fi

for library in "${incompatible_libraries[@]}"; do
  relative_path="${library#"$app_dir"/}"
  mkdir -p "$quarantine_dir/$(dirname "$relative_path")"
  mv -- "$library" "$quarantine_dir/$relative_path"
done

# linuxdeploy's AppRun binary prepends an AppDir GStreamer directory that does
# not exist. Seed its inherited path with the first host plugin directory that
# exists so WebKit can still discover codecs on Debian, Fedora, and Arch layouts.
app_run="$app_dir/AppRun"
if ! grep -q 'FRAMESHIFT_HOST_GSTREAMER' "$app_run"; then
  if [[ "$(tail -n 1 "$app_run")" != exec\ * ]]; then
    echo "ERROR: AppRun does not end with the expected exec command" >&2
    exit 1
  fi
  app_run_tmp="$(mktemp "$work_root/frameshift-apprun.XXXXXX")"
  cp -a -- "$app_run" "$quarantine_dir/AppRun.original"
  head -n -1 "$app_run" > "$app_run_tmp"
  cat >> "$app_run_tmp" <<'APP_RUN_FRAGMENT'

# FRAMESHIFT_HOST_GSTREAMER: use host plugins after bundled GStreamer removal.
for frameshift_gst_dir in \
  /usr/lib/gstreamer-1.0 \
  /usr/lib64/gstreamer-1.0 \
  /usr/lib/x86_64-linux-gnu/gstreamer-1.0; do
  if [[ -d "$frameshift_gst_dir" ]]; then
    export GST_PLUGIN_SYSTEM_PATH_1_0="$frameshift_gst_dir${GST_PLUGIN_SYSTEM_PATH_1_0:+:$GST_PLUGIN_SYSTEM_PATH_1_0}"
    break
  fi
done
APP_RUN_FRAGMENT
  tail -n 1 "$app_run" >> "$app_run_tmp"
  chmod --reference="$app_run" "$app_run_tmp"
  mv -- "$app_run_tmp" "$app_run"
fi

(
  cd "$tool_dir"
  "$appimagetool_plugin" --appimage-extract >/dev/null
)
appimagetool="$tool_dir/squashfs-root/usr/bin/appimagetool"
if [[ ! -x "$appimagetool" ]]; then
  echo "ERROR: embedded appimagetool was not found after plugin extraction" >&2
  exit 1
fi

ARCH=x86_64 "$appimagetool" "$app_dir" "$repacked_image"
chmod +x "$repacked_image"
mv -- "$app_image" "$quarantine_dir/$(basename "$app_image").original"
mv -- "$repacked_image" "$app_image"

echo "Repacked $app_image after quarantining ${#incompatible_libraries[@]} incompatible libraries in $quarantine_dir"
