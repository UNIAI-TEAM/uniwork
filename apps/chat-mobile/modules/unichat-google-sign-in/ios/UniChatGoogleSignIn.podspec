# UniChat's own Expo module (modules/unichat-google-sign-in), linked by expo-modules-autolinking from the app's
# modules/ folder. iOS half: Google's account chooser with a nonce (GoogleSignIn ≥ 9.0), for the app's Google sign-in.
Pod::Spec.new do |s|
  s.name           = 'UniChatGoogleSignIn'
  s.version        = '0.1.0'
  s.summary        = 'UniChat: Sign in with Google, with a nonce in the ID token'
  s.description    = 'UniChat: Sign in with Google, with a nonce in the ID token'
  s.license        = 'UNLICENSED'
  s.author         = 'UniWork'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # signIn(withPresenting:hint:additionalScopes:nonce:) arrived in 9.0: 7.x and 8.x take no nonce, and the server
  # refuses an ID token without one.
  s.dependency 'GoogleSignIn', '~> 9.0'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
