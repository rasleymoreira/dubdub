@echo off
rem Atalho de duplo clique para subir o servidor de voz do Kokoro.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-kokoro.ps1" %*
pause
