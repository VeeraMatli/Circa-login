#!/usr/bin/env bash
set -euo pipefail
cd /workspace/Circa-login
export npm_config_cache=/workspace/.npm-cache
npm ci --no-audit --no-fund
npm run db:migrate
npm run db:seed
bash scripts/install-swift-linux.sh
