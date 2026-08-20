# PROJECT_STYLE.md

# Design system deste projeto. Edite à vontade.

# Gerado em: 2026-08-17

## Projeto

name: Udemy Dub PT-BR
description: Extensao Chrome que dubla aulas da Udemy de ingles para portugues e troca o audio do player na reproducao.
tone: tecnico, direto, sem enfeite

## Stack

framework: HTML puro (Chrome Extension MV3, sem build)
typescript: nao
component_library: nenhuma
icons: SVG inline
animations: CSS

## Cores

primary: "#a435f0"
primary_hover: "#8710d8"
background: "#16151a"
surface: "#1f1e26"
border: "#332f3d"
text_primary: "#f2f0f7"
text_secondary: "#a09bb0"
accent: "#22d3ee"
success: "#10b981"
error: "#ef4444"
warning: "#f59e0b"

## Dark Mode

dark_mode: dark_only

## Tipografia

font_heading: "system-ui — sistema"
font_body: "system-ui — sistema"
font_mono: "ui-monospace, Consolas — sistema"

## Layout & Tokens

# Arredondamento: none | subtle (4-6px) | modern (8-12px) | rounded (16px+)

border_radius: modern

# Densidade: compact | balanced | spacious

density: compact

## Componentes Especificos do Dominio

- ProviderToggle: dois botoes segmentados (Deepgram / Google) com estado ativo em primary
- JobProgress: barra de progresso + label de etapa (transcrevendo / traduzindo / sintetizando)
- HudOverlay: painel flutuante dentro da pagina da Udemy, renderizado em Shadow DOM
  para nao herdar o CSS da Udemy. Estados: idle / working / ready / error.
