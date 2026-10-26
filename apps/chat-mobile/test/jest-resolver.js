// react-native-worklets/jest/resolver.js, narrowed. Worklets' *.native.ts files
// install its JSI runtime, which Jest does not have, so inside that package the
// plain files (its JS fallback) must win. Upstream matches any path containing
// "react-native-worklets", and under pnpm every package that peers on worklets
// lives in a directory named after it (node_modules/.pnpm/expo-modules-core@…_react-native-worklets@…),
// so it stripped the .native files of expo-modules-core too and every Expo
// native-module mock went missing. Here only the package itself is matched.
const WORKLETS = /[\\/]node_modules[\\/]react-native-worklets[\\/]/;

// A Jest sync resolver: (request, options) => path.
module.exports = (request, options) => {
  const inWorklets = WORKLETS.test(`${options.basedir}/`) || request === "react-native-worklets" || request.startsWith("react-native-worklets/");
  if (!inWorklets) return options.defaultResolver(request, options);
  return options.defaultResolver(request, { ...options, extensions: options.extensions?.filter((ext) => !ext.includes("native")) });
};
