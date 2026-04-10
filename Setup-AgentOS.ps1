# AgentOS Master Installer & Shortcut Generator
$appDir = Get-Location
$desktop = [System.IO.Path]::Combine($env:USERPROFILE, "Desktop")
$shell = New-Object -ComObject WScript.Shell

Write-Host "--- AgentOS Installation Suite ---" -ForegroundColor Cyan

# 1. Check for Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[!] Node.js is NOT installed. Please install it from https://nodejs.org/" -ForegroundColor Red
    return
}

# 2. Install Dependencies
Write-Host "[*] Installing NPM dependencies..." -ForegroundColor Yellow
npm install

# 3. Create Data Directories
if (!(Test-Path "logs")) { New-Item -ItemType Directory -Name "logs" }
if (!(Test-Path "data")) { New-Item -ItemType Directory -Name "data" }

# 4. Create the Watchdog Engine (Internal)
$engineContent = @"
while (`$true) {
    `$routerIp = "192.168.88.1"
    Stop-Process -Name "node" -ErrorAction SilentlyContinue
    Write-Host "Checking Router Connectivity..." -ForegroundColor Cyan
    while (!(Test-Connection `$routerIp -Count 1 -Quiet)) { Start-Sleep -Seconds 5 }
    Write-Host "Router Online! Starting AgentOS..." -ForegroundColor Green
    node index.js
    Write-Host "AgentOS crashed. Restarting in 10s..." -ForegroundColor Red
    Start-Sleep -Seconds 10
}
"@
$engineContent | Out-File -FilePath "$appDir\engine.ps1" -Encoding utf8

# 5. Create Desktop START Shortcut
Write-Host "[*] Creating Desktop Shortcuts..." -ForegroundColor Yellow
$startShortcut = $shell.CreateShortcut("$desktop\Start AgentOS.lnk")
$startShortcut.TargetPath = "powershell.exe"
$startShortcut.Arguments = "-ExecutionPolicy Bypass -File `"$appDir\engine.ps1`""
$startShortcut.WorkingDirectory = "$appDir"
$startShortcut.IconLocation = "shell32.dll, 12" # Router Icon
$startShortcut.Save()

# 6. Create Desktop STOP Shortcut
$stopShortcut = $shell.CreateShortcut("$desktop\Stop AgentOS.lnk")
$stopShortcut.TargetPath = "powershell.exe"
$stopShortcut.Arguments = "-Command `"Stop-Process -Name 'node' -Force; Stop-Process -Name 'powershell' -ErrorAction SilentlyContinue`""
$stopShortcut.IconLocation = "shell32.dll, 131" # Power Icon
$stopShortcut.Save()

Write-Host "`n[SUCCESS] AgentOS is ready!" -ForegroundColor Green
Write-Host "You now have 'Start AgentOS' and 'Stop AgentOS' on your Desktop." -ForegroundColor White