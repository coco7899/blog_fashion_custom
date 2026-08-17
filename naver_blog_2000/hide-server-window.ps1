$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = 'C:\Program Files\nodejs\node.exe'

# 이미 같은 블로그 서버가 실행 중이면 중복으로 띄우지 않는다.
$runningServer = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.CommandLine -like "*$projectRoot*server-custom.js*"
    } |
    Select-Object -First 1

if ($runningServer) {
    exit 0
}

# node.exe를 직접 예약 실행하면 검은 콘솔 창이 보일 수 있다.
# 숨김 PowerShell에서 서버를 시작해 로그인 직후에도 창이 나타나지 않게 한다.
Start-Process `
    -FilePath $nodePath `
    -ArgumentList 'server-custom.js' `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden

exit 0
