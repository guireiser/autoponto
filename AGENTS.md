# AGENTS.md – Autoponto

Contexto para agentes e contribuidores.

## Stack

- **Front-end:** HTML, CSS e JavaScript vanilla (sem framework). Uma única página (SPA) em `index.html`; lógica em `app.js`, estilos em `styles.css`.
- **Persistência:** [JSONBin.io](https://jsonbin.io) — um único bin com objeto `{ config, records }`. A **interface web** não chama o JSONBin direto: fala só com o **Cloudflare Worker** `workers/autoponto-punch/` (`WORKER_BASE_URL` em `config.js` / `config.local.js`). O Worker usa Master Key + Bin ID em secrets, expõe rotas `/auth/*` e `/api/bin` com **JWT** (`SESSION_SECRET`) e mantém **POST** `/` e `/punch` com **SHORTCUT_TOKEN** para o atalho iOS.
- **Deploy:** GitHub Pages via GitHub Actions. O workflow em `.github/workflows/deploy-pages.yml` gera `config.js` a partir de `config.template.js` substituindo `{{WORKER_BASE_URL}}` pelo secret **`AUTOPONTO_WORKER_URL`**. Publica `site/` (index.html, app.js, config.js, styles.css, config.json). O Worker é deploy **separado** na Cloudflare (`npx wrangler deploy`; secrets incluem `JSONBIN_*`, `SHORTCUT_TOKEN`, `SESSION_SECRET`).

## Onde está o quê

- **Migração JSONBin:** `scripts/migrate-all-records-gps.js` — define `source: 'gps'` em todos os registros e remove `editedInApp` (uso pontual com variáveis de ambiente; ver README).
- **Configuração injetada no deploy:** `config.template.js` (placeholder `{{WORKER_BASE_URL}}`). `config.js` é gerado no workflow e não é versionado. Localmente: `config.local.js` (ver `config.local.example.js`). No `index.html`, em produção (`github.io`) carrega `config.js` + `app.js`; em desenvolvimento tenta `config.local.js` antes de `app.js`.
- **Atalho iOS:** POST ao Worker com token no header — documentado no README e em `workers/autoponto-punch/README.md`. Deploy de referência: `https://autoponto-punch.reiser-gui.workers.dev` (`/` ou `/punch`).
- **Lógica da aplicação:** `app.js` — lê `window.APP_CONFIG` (`WORKER_BASE_URL`), obtém sessão com `POST /auth/login` ou `POST /auth/setup`, guarda JWT em **sessionStorage**, usa `GET/PUT /api/bin` com `Authorization: Bearer`, timeout 12s nas requisições e failsafe 16s em “Carregando…”, renderiza calendário (grade envolvida em `.calendar-scroll` com colunas `minmax(9.375rem, 1fr)` em `styles.css`), aba Feriados e modais, título do mês **Mês/Ano**, calcula horas por dia (data local; entrada +2 min / saída −2 min), normaliza `config.balance`, `config.holidaysExtra` / `config.holidaysRemoved`, `config.vacations` e **`config.dayComments`** (mapa data → texto; só exibido no modal do dia; ícone no calendário se houver) ao persistir. **Registros:** `records[]` podem ter `source: 'gps'` (atalho Worker) ou `source: 'manual'` (formulário web); **`editedInApp: true`** após salvar no modal de edição. Ícones na lista (calendário + modal): seta (GPS), lápis (manual ou editado). **Detalhes do dia:** botão no card (dia + chevron) abre modal com lista editável, + Ponto e comentário; no calendário a lista de pontos é só leitura. Feriados: semente `BR_HOLIDAYS_2026` + `buildHolidayMap` (inclui `applyVacationRangesToMap` com intervalos inclusivos em `config.vacations`); nome no card; no saldo, domingo, feriado ativo ou dia de férias **dobra** minutos trabalhados. **GPS:** `buildGpsNoiseIdSet` — pares consecutivos entrada/saída com intervalo real menor que 5 min ficam fora da UI e do saldo/totais; `records` no bin inalterados. Compatibilidade: evita optional chaining na inicialização.
- **Versão do app:** `config.json` → campo `version` (Changelog e referência).

## Fluxo de dados

1. **Carregamento:** Se existir JWT em `sessionStorage`, `GET /api/bin`; se 401, limpa token. Senão `GET /auth/meta` → tela login ou “Definir senha”. Após login/setup bem-sucedido, grava token e mostra o calendário.
2. **Calendário / Feriados:** `state.records`, totais (tempo real), saldo (com dobro em domingo, feriado ativo ou dia de férias), `config` com feriados e `config.vacations`.
3. **Alterações:** `PUT /api/bin` com JWT; o Worker reincorpora `config.password` do bin antes de gravar.
4. **Atalho iOS:** POST com `SHORTCUT_TOKEN`; Worker GET/PUT no JSONBin.

## Regras do projeto

- Alterações relevantes: `Changelog.md` + versão em `config.json`.
- Novos recursos/fluxos: `README.md`.
- Mudanças de arquitetura: este `AGENTS.md`.
