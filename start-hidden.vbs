Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\stop-dev-runtime.ps1""", 0, True
shell.Run "cmd.exe /c """ & root & "\start.bat""", 0, False
