@echo off
rem Ponte que o Chrome executa para falar com o host de controle do Piper.
rem Nao imprima nada aqui: a saida faz parte do protocolo de native messaging.
node "%~dp0host.cjs" %*
