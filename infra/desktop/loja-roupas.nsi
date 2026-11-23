Unicode true
Name "Loja de Roupas"
OutFile "../../dist/Loja-de-Roupas-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\Loja de Roupas"
InstallDirRegKey HKCU "Software\Loja de Roupas" "InstallDir"
RequestExecutionLevel user
Icon "..\..\apps\desktop\assets\loja-roupas.ico"
UninstallIcon "..\..\apps\desktop\assets\loja-roupas.ico"
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Loja de Roupas"
  SetShellVarContext current
  SetOutPath "$INSTDIR\app"
  File /r "..\..\dist\desktop-win32-x64\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Loja de Roupas.lnk" "$INSTDIR\app\electron.exe" "" "$INSTDIR\app\resources\app\assets\loja-roupas.ico" 0
  CreateShortcut "$DESKTOP\Loja de Roupas.lnk" "$INSTDIR\app\electron.exe" "" "$INSTDIR\app\resources\app\assets\loja-roupas.ico" 0
  WriteRegStr HKCU "Software\Loja de Roupas" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas" "DisplayName" "Loja de Roupas"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Loja de Roupas.lnk"
  Delete "$SMPROGRAMS\Loja de Roupas.lnk"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loja de Roupas"
  DeleteRegKey HKCU "Software\Loja de Roupas"
  RMDir "$INSTDIR"
SectionEnd
