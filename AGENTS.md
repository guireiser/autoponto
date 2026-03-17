# AGENTS.md – Autoponto

Contexto para agentes e contribuidores.

## Stack

- **Front-end:** HTML, CSS e JavaScript vanilla (sem framework). Uma única página (SPA) em `index.html`; lógica em `app.js`, estilos em `styles.css`.
- **Persistência:** [JSONBin.io](https://jsonbin.io) — um único bin com objeto `{ config, records }`. A página e o Shortcut do iPhone falam direto com a API do JSONBin (GET/PUT).
- **Deploy:** GitHub Pages via GitHub Actions. O repositório é estático; não há backend. O workflow em `.github/workflows/deploy-pages.yml` gera `config.js` a partir de `config.template.js` substituindo `{{BIN_ID}}` e `{{API_KEY}}` pelos valores dos Secrets `JSONBIN_BIN_ID` e `JSONBIN_MASTER_KEY`, e publica o diretório `site/` (com index.html, app.js, config.js, styles.css, config.json) como artefato para o Pages.

## Onde está o quê

- **Configuração injetada no deploy:** `config.template.js` (versionado, com placeholders). O arquivo `config.js` é gerado no workflow e não é versionado (está no `.gitignore`). Em desenvolvimento local usa-se `config.local.js` (copiar do template e preencher; também no `.gitignore`). No `index.html`, `config.js` é carregado primeiro; um script inline verifica se o host é `github.io` (produção): em produção carrega só `app.js` (não solicita `config.local.js`, evitando 404 no console). Em desenvolvimento local carrega `config.local.js` e em seguida `app.js`.
- **“API” de registro de ponto:** não existe endpoint no projeto. O Shortcut no iPhone faz GET no bin, adiciona um item em `records` e faz PUT de volta (documentado no README).
- **Lógica da aplicação:** `app.js` — lê `window.APP_CONFIG` (BIN_ID, API_KEY), chama JSONBin (GET/PUT) com timeout de 12s no GET e failsafe de 16s para evitar tela travada em “Carregando…”, gerencia login/senha (`config.password` no bin, sessionStorage para “logado”), renderiza o calendário e os modais de edição/adição, calcula horas por dia (pares entrada/saída em ordem cronológica), persiste com PUT ao editar/adicionar/excluir e evita optional chaining na inicialização para manter compatibilidade com navegadores mais antigos.
- **Versão do app:** `config.json` → campo `version` (usado para Changelog e referência).

## Fluxo de dados

1. **Carregamento:** `app.js` faz GET no bin; se existir `config.password`, exibe tela de login; senão, tela “Definir senha”. Após login, guarda “logado” em sessionStorage e mostra o calendário.
2. **Calendário:** registros em `state.records`; filtrados por data, ordenados por `datetime`; horas por dia = soma dos intervalos entre cada “entrada” e a próxima “saída” no mesmo dia.
3. **Alterações (editar/excluir/adicionar):** atualiza `state.records` (e `state.config` quando aplicável) e chama `apiPut({ config: state.config, records: state.records })`.

## Regras do projeto

- Ao fazer alterações relevantes, adicionar entradas no `Changelog.md` e registrar a versão conforme `config.json`.
- Atualizar o `README.md` quando houver novos recursos ou alterações.
- Atualizar este `AGENTS.md` quando houver mudanças de arquitetura, fluxo ou documentação para agentes.
