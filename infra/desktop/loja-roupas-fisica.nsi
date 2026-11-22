Unicode true
Name "Loja de Roupas Fisica"
OutFile "../../dist/Loja-de-Roupas-Fisica-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\Loja de Roupas Fisica"
InstallDirRegKey HKCU "Software\Loja de Roupas Fisica" "InstallDir"
RequestExecutionLevel user
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Loja de Roupas Fisica"
  SetShellVarContext current
  SetOutPath "$INSTDIR\app"
  File /r "..\..\dist\desktop-win32-x64\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Loja de Roupas Fisica.lnk" "$INSTDIR\app\electron.exe"
  WriteRegStr HKCU "Software\Loja de Roupas Fisica" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Fisica" "DisplayName" "Loja de Roupas Fisica"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Fisica" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Fisica" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Fisica" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Fisica" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Loja de Roupas Fisica.lnk"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas Fisica"
  DeleteRegKey HKCU "Software\Loja de Roupas Fisica"
  RMDir "$INSTDIR"
SectionEnd
