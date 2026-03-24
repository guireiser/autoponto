# AGENTS.md – Autoponto

Contexto para agentes e contribuidores.

## Stack

- **Front-end:** HTML, CSS e JavaScript vanilla (sem framework). Uma única página (SPA) em `index.html`; lógica em `app.js`, estilos em `styles.css`.
- **Persistência:** [JSONBin.io](https://jsonbin.io) — um único bin com objeto `{ config, records }`. A página web chama o JSONBin direto (GET/PUT). O registro pelo iPhone (Atalhos) usa o **Cloudflare Worker** `workers/autoponto-punch/`: **POST** autenticado por token → o Worker chama JSONBin (GET/PUT) com a Master Key, sem expor a key no dispositivo.
- **Deploy:** GitHub Pages via GitHub Actions para o site estático. O workflow em `.github/workflows/deploy-pages.yml` gera `config.js` a partir de `config.template.js` substituindo `{{BIN_ID}}` e `{{API_KEY}}` pelos valores dos Secrets `JSONBIN_BIN_ID` e `JSONBIN_MASTER_KEY`, e publica o diretório `site/` (com index.html, app.js, config.js, styles.css, config.json) como artefato para o Pages. O Worker é deploy **separado** na Cloudflare (`npx wrangler deploy` na pasta do worker; secrets via `wrangler secret put`), não faz parte do workflow do Pages.

## Onde está o quê

- **Configuração injetada no deploy:** `config.template.js` (versionado, com placeholders). O arquivo `config.js` é gerado no workflow e não é versionado (está no `.gitignore`). Em desenvolvimento local usa-se `config.local.js` (copiar do template e preencher; também no `.gitignore`). No `index.html`, `config.js` é carregado primeiro; um script inline verifica se o host é `github.io` (produção): em produção carrega só `app.js` (não solicita `config.local.js`, evitando 404 no console). Em desenvolvimento local carrega `config.local.js` e em seguida `app.js`.
- **“API” de registro de ponto (atalho):** o site não tem backend. O atalho iOS envia **POST** ao Worker `autoponto-punch` (token no header); o Worker faz GET no bin, acrescenta o registro em `records` e PUT (documentado no README e em `workers/autoponto-punch/README.md`). Deploy de referência documentado: `https://autoponto-punch.reiser-gui.workers.dev` (`/` ou `/punch`).
- **Lógica da aplicação:** `app.js` — lê `window.APP_CONFIG` (BIN_ID, API_KEY), chama JSONBin (GET/PUT) com timeout de 12s no GET e failsafe de 16s para evitar tela travada em “Carregando…”, gerencia login/senha (`config.password` no bin, localStorage para “logado”), renderiza o calendário e os modais de edição/adição, calcula horas por dia (pares entrada/saída em ordem cronológica) com base na **data local** do navegador, persiste com PUT ao editar/adicionar/excluir e evita optional chaining na inicialização para manter compatibilidade com navegadores mais antigos. O GET aceita resposta no formato `{ record }` ou com o bin direto no body (quando X-Bin-Meta: false).
- **Versão do app:** `config.json` → campo `version` (usado para Changelog e referência).

## Fluxo de dados

1. **Carregamento:** `app.js` faz GET no bin; se existir `config.password`, exibe tela de login; senão, tela “Definir senha”. Após login, guarda “logado” em localStorage e mostra o calendário.
2. **Calendário:** registros em `state.records`; filtrados por **data local do navegador** (não por string UTC), ordenados por `datetime`; horas por dia = soma dos intervalos entre cada “entrada” e a próxima “saída” no mesmo dia usando horário efetivo (**entrada +2 min**, **saída −2 min** em relação ao `datetime` salvo). A lista do dia mostra esses horários efetivos; o modal de edição continua com o valor salvo. Cada dia exibe “Total: Xh Ymin” e “Saldo:” (cumulativo ao fim daquele dia; **—** em hoje e dias futuros). A nav exibe “Saldo até ontem” (mesmo cálculo até a data local de ontem) e “Total do mês”. `config.balance` tem defaults no código e é normalizado em toda persistência. Ao clicar “+ Ponto” em um dia, o modal de adicionar abre com a data daquele dia e 08:00.
3. **Alterações (editar/excluir/adicionar):** atualiza `state.records` (e `state.config` quando aplicável) e chama `apiPut({ config: state.config, records: state.records })`.
4. **Atalho iOS:** POST ao Worker com `type` (e opcionalmente `datetime`); o Worker persiste no mesmo bin via JSONBin.

## Regras do projeto

- Ao fazer alterações relevantes, adicionar entradas no `Changelog.md` e registrar a versão conforme `config.json`.
- Atualizar o `README.md` quando houver novos recursos ou alterações.
- Atualizar este `AGENTS.md` quando houver mudanças de arquitetura, fluxo ou documentação para agentes.

## Cursor Cloud specific instructions

### Desenvolvimento local

Não há dependências para instalar (sem `package.json`, sem build step). O projeto é HTML/CSS/JS vanilla puro.

**Servidor local:**
```bash
python3 -m http.server 8080
```
Acessar `http://localhost:8080`. Isso é obrigatório — abrir `index.html` via `file://` causa bloqueio de CORS nas chamadas ao JSONBin.

**Configuração local (`config.local.js`):**
Copiar `config.template.js` para `config.local.js` e substituir os placeholders `{{BIN_ID}}` e `{{API_KEY}}` por valores reais do JSONBin.io. Sem isso, o app exibe "Falha ao carregar dados" (comportamento esperado). `config.local.js` está no `.gitignore`.

Os secrets necessários como variáveis de ambiente para criação automática do `config.local.js`:
- `JSONBIN_BIN_ID` — ID do bin no JSONBin.io
- `JSONBIN_MASTER_KEY` — Master Key do JSONBin.io

Para criar `config.local.js` automaticamente a partir dos secrets:
```bash
python3 -c "
import os
content = \"window.APP_CONFIG = {\\n  BIN_ID: '%s',\\n  API_KEY: '%s'\\n};\\n\" % (os.environ['JSONBIN_BIN_ID'], os.environ['JSONBIN_MASTER_KEY'])
open('config.local.js', 'w').write(content)
"
```

### Resetar o bin (opcional)

Para testes com estado limpo, resetar o bin via API:
```bash
curl -X PUT "https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}" \
  -H "Content-Type: application/json" \
  -H "X-Master-Key: ${JSONBIN_MASTER_KEY}" \
  -d '{"config": {}, "records": []}'
```
Após reset, o app exibirá a tela "Primeira vez: defina uma senha".

### Lint / Testes

Não há linter nem testes automatizados configurados no projeto. A validação é manual via navegador.

### Cloudflare Worker (opcional)

O worker em `workers/autoponto-punch/` requer Node.js e Wrangler (`npx wrangler dev`) apenas para testar o fluxo de atalho iOS. O frontend funciona independentemente do worker.
