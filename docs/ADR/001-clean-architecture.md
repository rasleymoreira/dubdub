# 001 — Adotar Clean Architecture

**Status:** aceita

## Contexto

O código crescia por acréscimo: cada motor de voz novo era encaixado no arquivo que já existia.
Isso produziu três sintomas mensuráveis:

- adicionar um motor exigia editar seis arquivos em três camadas conceituais;
- a regra de negócio importava clientes HTTP concretos, então testar a escolha de motor exigia
  rede;
- o arquivo de constantes mudava por quatro motivos independentes (protocolo de mensagem,
  catálogo de vozes, configuração padrão, regra de fallback).

Nenhum desses é problema de estilo. Os três encarecem mudança.

## Decisão

Quatro camadas concêntricas, com dependências apontando só para dentro:

```
domain ← application ← infrastructure ← presentation
```

`domain` tem as regras puras e não conhece ninguém. `application` declara portas (interfaces) e
orquestra casos de uso. `infrastructure` implementa as portas. `presentation` monta tudo nos três
contextos do Chrome.

A regra é **aplicada pelo ESLint**, não deixada como convenção.

## Consequências

**Ganho.** A lógica mais delicada do projeto — sincronia do player, escolha de motor, preparo do
texto — virou função pura, coberta por testes que rodam offline em menos de um segundo. Antes,
testar a sincronia exigia instanciar o player inteiro com stubs de `Audio`, `URL` e `<video>`.

**Custo.** Mais arquivos e mais indireção. Uma mudança que antes era uma linha num `switch` agora
pode tocar uma porta, um adapter e o container. Para um projeto que já tem sete provedores e
provavelmente terá mais, o troco compensa; para três arquivos, não compensaria.

**Custo real e recorrente.** A barreira de camada vai incomodar quando alguém quiser um atalho.
É exatamente para isso que ela existe, mas é um atrito genuíno, não gratuito.

## Alternativas

**Manter a estrutura por tipo de arquivo** (`lib/`, `content/`, `popup/`). É o que havia. Não
separa regra de infraestrutura, que era o problema.

**Hexagonal pura (ports & adapters), sem a divisão domain/application.** Muito próxima do
resultado. A divisão extra ficou porque há regras que não são caso de uso — a matemática da
sincronia, por exemplo, não é "algo que o sistema faz", é "algo que é verdade".

**Feature slices verticais.** Funciona bem quando as features são independentes. Aqui há um
pipeline só, com variação nos provedores: a divisão horizontal descreve melhor a realidade.
