@echo off
rem Sestaví NotLoL.exe do složky dist\ (potřebuje .NET 10 SDK)
cd /d "%~dp0"
dotnet publish -c Release -o dist -nologo
if errorlevel 1 (
  echo.
  echo Build selhal.
  pause
  exit /b 1
)
echo.
echo Hotovo: %~dp0dist\NotLoL.exe
pause
