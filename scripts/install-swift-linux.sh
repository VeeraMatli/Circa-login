#!/usr/bin/env bash
set -euo pipefail
# Optional Linux contract/syntax tooling. This cannot supply the Apple iOS SDK.
install_root=/workspace/toolchains/swift6
if [[ -x "$install_root/usr/bin/swift" ]]; then
  "$install_root/usr/bin/swift" --version
  exit 0
fi
[[ "$(uname -m)" == x86_64 ]] || { echo 'This toolchain archive requires Linux x86_64.' >&2; exit 1; }
work_dir=$(mktemp -d /tmp/anvaya-swift-install.XXXXXX)
trap 'rm -rf "$work_dir"' EXIT
archive_base=https://download.swift.org/swift-6.0.3-release/ubuntu2404/swift-6.0.3-RELEASE/swift-6.0.3-RELEASE-ubuntu24.04.tar.gz
curl --fail --location --show-error "$archive_base" -o "$work_dir/swift.tar.gz"
curl --fail --location --show-error "$archive_base.sig" -o "$work_dir/swift.tar.gz.sig"
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/swiftlang/swift-org-website.git "$work_dir/site"
git -C "$work_dir/site" show HEAD:keys/release-key-swift-6.x.asc > "$work_dir/key.asc"
mkdir -m 700 "$work_dir/gnupg"
gpg --homedir "$work_dir/gnupg" --batch --import "$work_dir/key.asc"
gpg --homedir "$work_dir/gnupg" --batch --status-fd 1 --verify "$work_dir/swift.tar.gz.sig" "$work_dir/swift.tar.gz" > "$work_dir/verification"
# Pin the official Swift 6 release signing key, not an arbitrary imported signer.
rg '^\[GNUPG:\] VALIDSIG 52BB7E3DE28A71BE22EC05FFEF80A866B47A981F ' "$work_dir/verification"
mkdir -p "$install_root"
tar -xzf "$work_dir/swift.tar.gz" -C "$install_root" --strip-components=1
"$install_root/usr/bin/swift" --version
