@echo off
rem DuoForge - made by 4me89. Double-click to start.
cd /d "%~dp0"
rem Installed in <project>\tools\duo: the project is found. Anywhere else: ask for the project folder.
for %%I in ("%~dp0.") do set "HERE=%%~nxI"
for %%I in ("%~dp0..") do set "UP=%%~nxI"
if "%DUO_PROJECT%"=="" if /i not "%UP%\%HERE%"=="tools\duo" set /p "DUO_PROJECT=Project folder (full path): "
start "" http://localhost:4747
node server.js
pause
