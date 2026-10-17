// Ported from usf apps/mobile/metro.config.js. Watches the monorepo so the
// @uniwork/core subpaths resolve, looks up node_modules from the app and the
// root, and follows symlinks for pnpm's isolated layout.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;

// Absolute paths: tools that load this file from the repo root (knip) must
// not resolve the CSS and the Tailwind config against their own cwd.
module.exports = withNativeWind(config, {
  input: path.resolve(projectRoot, "global.css"),
  configPath: path.resolve(projectRoot, "tailwind.config.js"),
  inlineRem: 16,
});
