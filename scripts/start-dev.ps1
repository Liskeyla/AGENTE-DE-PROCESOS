# Inicia backend (8003) y frontend (3002) del Agente de Procesos
# Uso:
#   .\scripts\start-dev.ps1           -> ventanas externas (como antes)
#   .\scripts\start-dev.ps1 -Inline  -> muestra comandos para terminales de Cursor
param(
  [switch]$Inline
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Port = 8003

Write-Host "Deteniendo instancias previas..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*Agente de Procesos*backend*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*Agente de Procesos*frontend*" -or $_.CommandLine -match "next dev.*3002" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

$envLocal = Join-Path $Frontend ".env.local"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($envLocal, "NEXT_PUBLIC_API_URL=http://localhost:$Port/api/v1", $utf8NoBom)

foreach ($procId in @(Get-NetTCPConnection -LocalPort 8003 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)) {
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}
foreach ($procId in @(Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)) {
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

if ($Inline) {
  Write-Host "Modo Inline: usa terminales de Cursor (sin ventanas externas)" -ForegroundColor Cyan
  Write-Host "Backend:  http://127.0.0.1:$Port" -ForegroundColor Green
  Write-Host "Frontend: http://localhost:3002" -ForegroundColor Green
  Write-Host "Login:    demo@empresa.com / demo1234" -ForegroundColor Green
  Write-Host ""
  Write-Host "Terminal 1 (backend):" -ForegroundColor Yellow
  Write-Host "  cd `"$Backend`"; .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port $Port"
  Write-Host "Terminal 2 (frontend):" -ForegroundColor Yellow
  Write-Host "  cd `"$Frontend`"; npm run dev -- -p 3002"
  exit 0
}

Write-Host "Iniciando backend en http://127.0.0.1:$Port ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$Backend'; .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port $Port"
) -WindowStyle Normal

Start-Sleep -Seconds 4

Write-Host "Iniciando frontend en http://localhost:3002 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$Frontend'; npm run dev -- -p 3002"
) -WindowStyle Normal

Start-Sleep -Seconds 8

Write-Host ""
Write-Host "=== Servicios ===" -ForegroundColor Green
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
  Write-Host "Backend:  OK  ($($health.version))" -ForegroundColor Green
} catch {
  Write-Host "Backend:  ESPERANDO (puede tardar unos segundos mas)" -ForegroundColor Yellow
}

try {
  $llm = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health/llm" -TimeoutSec 30
  if ($llm.ok) { Write-Host "Gemini:   OK" -ForegroundColor Green }
  else { Write-Host "Gemini:   $($llm.error)" -ForegroundColor Red }
} catch {
  Write-Host "Gemini:   no verificado" -ForegroundColor Yellow
}

Write-Host "Frontend: http://localhost:3002" -ForegroundColor Green
Write-Host "Login:    demo@empresa.com / demo1234" -ForegroundColor Green
