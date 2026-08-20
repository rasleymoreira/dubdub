# Decisões arquiteturais

Registro curto de decisões que moldaram o projeto: o contexto, a escolha e o que ela custa.
Existem para que uma decisão tomada com motivo não seja revertida por falta dele.

| #   | Decisão                                                                | Status |
| --- | ---------------------------------------------------------------------- | ------ |
| 001 | [Adotar Clean Architecture](001-clean-architecture.md)                 | aceita |
| 002 | [TypeScript com build por esbuild](002-typescript-e-esbuild.md)        | aceita |
| 003 | [Nenhuma credencial no código](003-sem-credenciais-no-codigo.md)       | aceita |
| 004 | [Catálogo de motores como fonte única](004-catalogo-fonte-unica.md)    | aceita |
| 005 | [Separar testes unitários de integração](005-testes-em-duas-suites.md) | aceita |

## Formato

Cada ADR tem quatro seções: **Contexto** (o que existia), **Decisão** (o que passou a valer),
**Consequências** (o que melhora e o que piora) e **Alternativas** (o que foi considerado e por
que não). Curto de propósito — se passa de uma página, provavelmente são duas decisões.
