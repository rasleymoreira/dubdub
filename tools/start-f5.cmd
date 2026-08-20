@echo off
rem Atalho de duplo clique para subir o servidor de voz do F5-TTS.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-f5.ps1" %*
pause
