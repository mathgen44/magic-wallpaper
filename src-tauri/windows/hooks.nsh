; Crochets de l'installeur NSIS (Tauri).
; L'application s'appelait « Dynamic Background » jusqu'à la v0.4 : on ferme puis on
; désinstalle silencieusement l'ancienne version pour éviter deux fonds d'écran en parallèle.
; Les dispositions sont conservées et reprises au premier lancement de Magic Wallpaper.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM "Dynamic Background.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "dynamic-background.exe"'
  Pop $0
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dynamic Background" "UninstallString"
  StrCmp $R0 "" +2 0
    ExecWait '$R0 /S'
!macroend
