// The custom scheme of the build under test, for openLink: uniworkchat for a staging or production build (the
// nightly), uniworkchat-dev for the dev build the PR's hermetic run makes (mobile-verify.yml › android-e2e sets
// MAESTRO_APP_SCHEME). Leaves it in output.scheme.
output.scheme = typeof MAESTRO_APP_SCHEME === "undefined" || !MAESTRO_APP_SCHEME ? "uniworkchat" : MAESTRO_APP_SCHEME;
