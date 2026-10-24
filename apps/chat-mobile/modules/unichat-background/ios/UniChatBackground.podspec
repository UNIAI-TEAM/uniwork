# UniChat's own Expo module (modules/unichat-background), linked by expo-modules-autolinking from the app's
# modules/ folder. iOS half: the background task that lets a send finish as the app leaves the screen.
Pod::Spec.new do |s|
  s.name           = 'UniChatBackground'
  s.version        = '0.1.0'
  s.summary        = 'UniChat: time to finish sending as the app goes to the background'
  s.description    = 'UniChat: time to finish sending as the app goes to the background'
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

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
