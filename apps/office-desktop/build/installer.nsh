!include LogicLib.nsh
!include FileFunc.nsh

; The authenticated download ZIP puts this public profile beside the installer.
; Keep it outside app.asar so the main-process resolver can validate it on boot.
!macro customInstall
  IfFileExists "$EXEDIR\deployment-profile.json" 0 profile_done
  CreateDirectory "$INSTDIR\resources"
  CopyFiles /SILENT "$EXEDIR\deployment-profile.json" "$INSTDIR\resources\deployment-profile.json"
  profile_done:
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
