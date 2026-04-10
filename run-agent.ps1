# AgentOS Watchdog Script
$routerIp = "192.168.88.1"

do {
    # 1. Check if Router is actually reachable before starting Node
    Write-Host "`n[Checking Connectivity]" -ForegroundColor Cyan
    while (!(Test-Connection $routerIp -Count 1 -Quiet)) { 
        Write-Host "Waiting for MikroTik ($routerIp) to boot..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5 
    }

    Write-Host "Router is ONLINE! Initializing AgentOS..." -ForegroundColor Green
    [console]::beep(1000, 500)

    # 2. Start the Node.js Application
    # Replace 'server.js' with the actual filename of your script
    node server.js

    # 3. Handle Crashes/Exits
    Write-Host "`n[ALERT] AgentOS stopped or crashed." -ForegroundColor Red
    Write-Host "Waiting 30 seconds for system cool-down before checking router again..." -ForegroundColor Gray
    Start-Sleep -Seconds 30

} while ($true)