; Edição comercial: mesma base da edição física, com ativação obrigatória,
; pasta de instalação, registro e dados próprios (não substitui a edição livre).
Unicode true
Name "Loja de Roupas"
OutFile "../../dist/Loja-de-Roupas-Comercial-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\Loja de Roupas Comercial"
InstallDirRegKey HKCU "Software\Loja de Roupas Comercial" "InstallDir"
RequestExecutionLevel user
!define MUI_ICON "..\..\apps\desktop\assets\loja-roupas.ico"
!define MUI_UNICON "..\..\apps\desktop\assets\loja-roupas.ico"
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\app\electron.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Iniciar Loja de Roupas agora"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Loja de Roupas"
  SetShellVarContext current
  SetOutPath "$INSTDIR\app"
  File /r "..\..\dist\desktop-win32-x64\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Loja de Roupas Comercial.lnk" "$INSTDIR\app\electron.exe" "" "$INSTDIR\app\resources\app\assets\loja-roupas.ico" 0
  CreateShortcut "$DESKTOP\Loja de Roupas Comercial.lnk" "$INSTDIR\app\electron.exe" "" "$INSTDIR\app\resources\app\assets\loja-roupas.ico" 0
  WriteRegStr HKCU "Software\Loja de Roupas Comercial" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial" "DisplayName" "Loja de Roupas"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial" "DisplayIcon" "$INSTDIR\app\resources\app\assets\loja-roupas.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial" "Publisher" "ArtiSys"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Loja de Roupas Comercial.lnk"
  Delete "$SMPROGRAMS\Loja de Roupas Comercial.lnk"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Comercial"
  DeleteRegKey HKCU "Software\Loja de Roupas Comercial"
  RMDir "$INSTDIR"
SectionEnd
