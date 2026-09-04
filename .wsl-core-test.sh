export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use v22.23.2 >/dev/null 2>&1
export PATH="$NVM_DIR/versions/node/v22.23.2/bin:$PATH"
cd "/mnt/d/Java 6/be-uniwork/uniwork"
pnpm --filter @uniwork/core test