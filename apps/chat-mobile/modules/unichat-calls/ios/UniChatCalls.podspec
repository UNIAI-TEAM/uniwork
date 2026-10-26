# UniChat's own Expo module (modules/unichat-calls), linked by expo-modules-autolinking from the app's modules/ folder.
# iOS half (docs/adr/0038): PushKit's VoIP token and pushes, reported to CallKit, and CallKit's answer, decline and end
# handed to JavaScript. Android's half is android/ (Kotlin).
Pod::Spec.new do |s|
  s.name           = 'UniChatCalls'
  s.version        = '0.1.0'
  s.summary        = 'UniChat: incoming calls through PushKit and CallKit'
  s.description    = 'UniChat: incoming calls through PushKit and CallKit'
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
  s.frameworks = 'AVFoundation', 'CallKit', 'PushKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
