!include LogicLib.nsh
!include FileFunc.nsh

; Beta and stable intentionally share APP_FILENAME/appId, so this keeps their
; per-user install directory identical while the display name may change.
!macro preInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCT_FILENAME}"
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
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif
  ${EndIf}
!macroend
