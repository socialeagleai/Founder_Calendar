# Founder Calendar backend launcher (Windows PowerShell)
# Usage:  .\start.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Starting PostgreSQL (Docker)..." -ForegroundColor Cyan
docker compose up -d db

Write-Host "==> Waiting for database..." -ForegroundColor Cyan
for ($i = 0; $i -lt 15; $i++) {
    docker exec founder_calendar_db pg_isready -U founder -d founder_calendar *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "    database ready"; break }
    Start-Sleep -Seconds 2
}

if (-not (Test-Path ".venv")) {
    Write-Host "==> Creating virtualenv + installing deps..." -ForegroundColor Cyan
    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install --upgrade pip
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
}

Write-Host "==> Starting FastAPI on http://127.0.0.1:8000  (docs: /docs)" -ForegroundColor Green
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
