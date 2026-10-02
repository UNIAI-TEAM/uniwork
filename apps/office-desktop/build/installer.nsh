!include LogicLib.nsh
!include FileFunc.nsh
!include WinVer.nsh
!include x64.nsh

; The authenticated download ZIP puts this public profile beside the installer.
; Keep it outside app.asar so the main-process resolver can validate it on boot.
!macro customInstall
  IfFileExists "$EXEDIR\deployment-profile.json" 0 profile_done
  CreateDirectory "$INSTDIR\resources"
  CopyFiles /SILENT "$EXEDIR\deployment-profile.json" "$INSTDIR\resources\deployment-profile.json"
  profile_done:
!macroend

; --- Wrong-machine guard (spec §4 "Chặn cài sai máy") -----------------------
; Every unsigned dev installer checks the minimum machine before a single file
; is copied. A refused install leaves nothing behind: silent (/S) exits with a
; non-zero code and no dialog, assisted mode shows one bilingual (vi + en)
; message box. Windows on ARM64 is allowed because the x64 build runs there
; through emulation. UNIWORK_TEST_FORCE_* defines exist only for the lane's
; forced-failure proof and are never set for a normal build.
Var UniWorkWindowsVersion

!macro UniWorkRefuseInstall message
  ${If} ${Silent}
    SetErrorLevel 3
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "${message}"
  ${EndIf}
  ; .onInit runs SetOutPath before this check, which may have created an empty
  ; $INSTDIR and left it as the process working directory. Move the output path
  ; away first, then remove the empty directory: RMDir removes only an empty
  ; directory, so an existing installation is never touched.
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
  Abort
!macroend

!macro UniWorkReadWindowsVersion
  ReadRegStr $UniWorkWindowsVersion HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "ProductName"
  ${If} $UniWorkWindowsVersion == ""
    StrCpy $UniWorkWindowsVersion "unknown Windows"
  ${EndIf}
!macroend

!macro customInit
  !ifdef UNIWORK_TEST_FORCE_OLD_WINDOWS
    !insertmacro UniWorkRefuseInstall "UniWork Office cần Windows 10 hoặc mới hơn, bản 64-bit. Máy này: Windows cũ (kiểm tra thử).$\r$\nUniWork Office requires Windows 10 or newer, 64-bit. This machine: older Windows (test)."
  !endif
  !ifdef UNIWORK_TEST_FORCE_NOT_X64
    !insertmacro UniWorkRefuseInstall "UniWork Office cần Windows 64-bit (x64). Máy này: 32-bit (kiểm tra thử).$\r$\nUniWork Office requires 64-bit Windows (x64). This machine: 32-bit (test)."
  !endif
  !insertmacro UniWorkReadWindowsVersion
  ${IfNot} ${AtLeastWin10}
    !insertmacro UniWorkRefuseInstall "UniWork Office cần Windows 10 hoặc mới hơn, bản 64-bit. Máy này: $UniWorkWindowsVersion.$\r$\nUniWork Office requires Windows 10 or newer, 64-bit. This machine: $UniWorkWindowsVersion."
  ${EndIf}
  ${IfNot} ${RunningX64}
    !insertmacro UniWorkRefuseInstall "UniWork Office cần Windows 64-bit (x64). Máy này không phải bản 64-bit.$\r$\nUniWork Office requires 64-bit Windows (x64). This machine is not 64-bit."
  ${EndIf}
!macroend

!pragma warning disable 6001
Var UniWorkDeleteAppData
!pragma warning enable 6001

; Assisted UI asks explicitly, with the safe answer selected by default.
; Silent uninstall preserves data unless --delete-app-data is supplied by an
; operator who deliberately opted in.
!macro customUnInit
  StrCpy $UniWorkDeleteAppData "0"
  ${If} ${Silent}
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${IfNot} ${Errors}
      StrCpy $UniWorkDeleteAppData "1"
    ${EndIf}
  ${Else}
    MessageBox MB_YESNO|MB_DEFBUTTON2 "Delete UniWork Office settings and drafts? Choose No to keep them." IDYES +2
    Goto done
    StrCpy $UniWorkDeleteAppData "1"
  ${EndIf}
  done:
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\@USER_SCHEME@"
  ${If} $UniWorkDeleteAppData == "1"
    SetShellVarContext current
    RMDir /r "$APPDATA\@USER_DATA_NAMESPACE@"
  ${EndIf}
!macroend
