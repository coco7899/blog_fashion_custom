Option Explicit

Dim shell, fso, projectPath, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Always start the server from the folder that contains this file.
' This keeps the startup shortcut correct even when the project is moved.
projectPath = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = projectPath & "\hide-server-window.ps1"

command = """C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe""" & _
    " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass" & _
    " -File """ & scriptPath & """"

' Window style 0 keeps the one-time Windows logon launch completely invisible.
shell.Run command, 0, True

Set shell = Nothing
Set fso = Nothing
