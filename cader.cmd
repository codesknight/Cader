@echo off
setlocal
if exist "%~dp0.cader\tools\node-v24.9.0-win-x64\node.exe" (
  "%~dp0.cader\tools\node-v24.9.0-win-x64\node.exe" "%~dp0apps\cli\bin\cader.cjs" %*
) else (
  node "%~dp0apps\cli\bin\cader.cjs" %*
)
