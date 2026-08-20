@echo off
rem Atalho de duplo clique para subir o servidor de voz do Piper.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-piper.ps1" %*
pause
