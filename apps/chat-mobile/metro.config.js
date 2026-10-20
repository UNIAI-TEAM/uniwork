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
// NativeWind's babel preset rewrites every JSX file to import
// react-native-css-interop/jsx-runtime, a dependency of nativewind the app
// never names; pnpm's isolated layout does not hoist it. Pointing Metro at
// nativewind's own copy keeps exactly one css-interop in the bundle (two
// would split the style registry), without hoisting. knip lists it under
// ignoreDependencies: it is nativewind's dependency, not the app's.
config.resolver.extraNodeModules = {
  "react-native-css-interop": path.dirname(
    require.resolve("react-native-css-interop/package.json", { paths: [path.dirname(require.resolve("nativewind/package.json"))] }),
  ),
};

// Absolute paths: tools that load this file from the repo root (knip) must
// not resolve the CSS and the Tailwind config against their own cwd.
module.exports = withNativeWind(config, {
  input: path.resolve(projectRoot, "global.css"),
  configPath: path.resolve(projectRoot, "tailwind.config.js"),
  inlineRem: 16,
});
