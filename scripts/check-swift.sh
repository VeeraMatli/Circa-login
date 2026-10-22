#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
if [[ -x /workspace/toolchains/swift6/usr/bin/swift ]]; then
  swift_dir=/workspace/toolchains/swift6/usr/bin
else
  swift_dir=$(dirname -- "$(command -v swift)")
fi
export SWIFTPM_MODULECACHE_OVERRIDE=/tmp/anvaya-swift-module-cache
export CLANG_MODULE_CACHE_PATH=/tmp/anvaya-swift-module-cache
"$swift_dir/swift-format" lint --strict --recursive apps/ios tests/contracts/swift packages/api-contract/swift-client
rg --files apps/ios -g '*.swift' -0 | xargs -0 "$swift_dir/swiftc" -frontend -parse
"$swift_dir/swift" test --package-path tests/contracts/swift --scratch-path /tmp/anvaya-swift-build --cache-path /tmp/anvaya-swift-cache --config-path /tmp/anvaya-swift-config --security-path /tmp/anvaya-swift-security
