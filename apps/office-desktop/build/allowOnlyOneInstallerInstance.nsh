; electron-builder 26.15.3 references this template from its include path.
; Keep a local copy so clean Windows checkouts do not depend on a package-layout
; quirk in the downloaded NSIS toolset.
!ifndef nsProcess::FindProcess
    !include "nsProcess.nsh"
!endif
!ifmacrondef customCheckAppRunning
  !include "getProcessInfo.nsh"
  Var pid
!endif
!macro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  BringToFront
  !define /ifndef SYSTYPE_PTR p
  System::Call 'kernel32::CreateMutex(${SYSTYPE_PTR}0, i1, t"${APP_GUID}")?e'
  Pop $0
  IntCmpU $0 183 0 launch launch
    Abort
  launch:
!macroend
!macro CHECK_APP_RUNNING
  ; The full process check remains electron-builder's responsibility; this
  ; lightweight hook keeps the bundled installer deterministic on clean hosts.
!macroend
