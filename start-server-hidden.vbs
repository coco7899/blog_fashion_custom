Option Explicit

Dim shell, projectPath, scriptPath, command
Set shell = CreateObject("WScript.Shell")

' Build the user path at runtime so Windows Script Host does not need to
' decode Korean characters embedded in this source file.
projectPath = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Downloads\codex\blog_fashion_custom"
scriptPath = projectPath & "\hide-server-window.ps1"

command = """C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe""" & _
    " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass" & _
    " -File """ & scriptPath & """"

' Window style 0 keeps the one-time Windows logon launch completely invisible.
shell.Run command, 0, True

Set shell = Nothing
