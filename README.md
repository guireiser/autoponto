# Autoponto

Aplicativo estático de controle de ponto de trabalho para publicar no GitHub Pages. Os dados são persistidos em um bin no [JSONBin.io](https://jsonbin.io). Inclui tela de calendário com registros por dia, cálculo de horas trabalhadas (entrada/saída), senha de acesso e registro de ponto pelo **Atalhos** no iPhone via **Cloudflare Worker** (POST com token).

## Funcionalidades

- **Calendário mensal** com **prévia dos pontos** no card (sem editar no card), totais por dia, título **Mês/Ano** (ex.: Março/2026) e **botão no topo do dia** (número, chevron) que abre o modal com edição, **+ Ponto** e **comentário do dia** (texto do comentário só no modal; ícone 💬 no botão se houver comentário — `config.dayComments`). Ao lado de cada horário, **ícones de origem**: seta azul para batidas do **atalho** (`source: 'gps'`), lápis para inclusão pela **web** ou após **edição** (`source: 'manual'` ou `editedInApp`). Em telas estreitas a grade permite **rolagem horizontal** para manter largura mínima dos cards
- **Total de horas por dia** (rótulo "Total:" em cada dia), **Saldo:** cumulativo ao fim daquele dia (em hoje e dias futuros mostra **—**), **total do mês** e **saldo até ontem** na barra (mesma regra de cálculo; padrão: +4h56 antes de 2026-03-23; seg–qui 9h, sex 8h, fim de semana 0 — ver `config.balance` no bin). Em **domingo**, **feriado ativo** ou **dia dentro de um período de férias** cadastrado, as horas trabalhadas entram **em dobro** só no cálculo do saldo (o "Total:" do dia continua sendo o tempo real).
- **Feriados:** semente com feriados nacionais e principais móveis de **2026** (inclui Carnaval e Corpus Christi; desative os que forem só ponto facultativo na sua rotina). Aba **Feriados** para incluir datas manuais, editar nome e restaurar / ignorar os da semente. **Férias:** períodos com início e fim (`config.vacations`); cada dia do intervalo se comporta como feriado (visual, rótulo e dobro no saldo). Dias feriado ou de férias aparecem com estilo distinto no calendário e com o **nome** no card do dia.
- **Cálculo de horas trabalhadas** por dia (soma dos intervalos entre cada par entrada → saída), com agrupamento por data local do navegador (evita deslocamento de dia por UTC). Regra fixa: horário efetivo da **entrada** = registro **+2 min**; da **saída** = registro **−2 min** (o armazenamento segue o horário real batido ou digitado). Para reduzir ruído de GPS, pares **consecutivos** (em ordem global) entrada/saída ou saída/entrada com menos de **5 minutos** entre os horários **reais** são omitidos na lista e nos totais/saldo, mas **permanecem** no bin.
- **Edição manual:** adicionar, editar horário e excluir registros a partir do **modal do dia**; ao adicionar ponto, a data do dia aberto já vem preenchida
- **Senha de acesso** à página (definida na primeira vez e armazenada no bin)
- **Deploy no GitHub Pages** com URL pública do Worker injetada por GitHub Secret (`AUTOPONTO_WORKER_URL`); Master Key e Bin ID **não** vão para o bundle do site
- **Shortcut no iPhone** para registrar entrada/saída pelo Worker (POST; documentado abaixo)

## Pré-requisitos

- Conta no [JSONBin.io](https://jsonbin.io) (plano gratuito)
- Repositório no GitHub com GitHub Pages habilitado via **GitHub Actions**
- Para o atalho no iPhone: conta na [Cloudflare](https://dash.cloudflare.com/) (plano gratuito) e deploy do Worker em [`workers/autoponto-punch/`](workers/autoponto-punch/) — ver [README do worker](workers/autoponto-punch/README.md)

## Configurar JSONBin e Cloudflare Worker

A Master Key e o Bin ID ficam **apenas** nos secrets do Worker (Wrangler), não no repositório nem no JavaScript publicado no Pages.

1. Crie o bin no [JSONBin.io](https://jsonbin.io) com o corpo inicial `{ "config": {}, "records": [] }` e anote **Bin ID** e **Master Key** (ou Access Key com leitura/escrita).
2. Faça deploy do Worker em [`workers/autoponto-punch/`](workers/autoponto-punch/) e configure os secrets com `npx wrangler secret put` — ver [README do worker](workers/autoponto-punch/README.md) (**inclui `SESSION_SECRET`** para sessão da interface web).
3. Anote a URL pública do Worker (ex.: `https://autoponto-punch.seu-subdominio.workers.dev`, **sem barra no final**).

## Configurar Secret no GitHub (somente Pages)

O workflow gera `config.js` só com a URL do Worker.

### 1. Abrir os Secrets do repositório

**Settings** → **Secrets and variables** → **Actions**.

### 2. Criar o secret

- **Nome:** `AUTOPONTO_WORKER_URL`
- **Valor:** a URL base do Worker (a mesma usada no atalho iOS, ex.: `https://autoponto-punch.reiser-gui.workers.dev`)

### 3. Arquivo versionado

O [`config.template.js`](config.template.js) contém apenas o placeholder `{{WORKER_BASE_URL}}`. Não commite `config.js` nem `config.local.js` com dados reais.

### 4. Rodar o deploy do site

Após salvar o secret, o push na `main` gera `config.js` e publica o Pages. **Ordem recomendada:** deploy do Worker (com `SESSION_SECRET`) antes do deploy do site. Em **Settings** → **Pages**, use **Source: GitHub Actions**.

---

## Shortcut no iPhone (Cloudflare Worker)

O site no GitHub Pages não expõe POST. O app **Atalhos** envia um único **POST** ao Worker em [`workers/autoponto-punch/`](workers/autoponto-punch/): a **Master Key** do JSONBin fica só nos secrets do Worker, não no iPhone. Instalação: `npx wrangler deploy` e secrets — passo a passo no [README do worker](workers/autoponto-punch/README.md).

**URL do Worker em produção (este repositório):** [`https://autoponto-punch.reiser-gui.workers.dev`](https://autoponto-punch.reiser-gui.workers.dev) — use `https://autoponto-punch.reiser-gui.workers.dev/` ou `/punch` no atalho. Em forks ou outra conta Cloudflare, o deploy próprio gera outra URL (a que o Wrangler exibir após `npx wrangler deploy`).

**Contrato HTTP**

- **POST** na raiz `/` ou em `/punch` (mesmo comportamento).
- **Cabeçalho** (um dos dois):
  - `Authorization: Bearer <SEU_SHORTCUT_TOKEN>`
  - ou `X-Autoponto-Token: <SEU_SHORTCUT_TOKEN>`
- **Corpo** (JSON):
  - `type`: `"entrada"` ou `"saída"` (também aceita `saida` sem acento)
  - `datetime`: opcional, string ISO 8601; se omitir, o Worker usa o instante atual (UTC)

Resposta em caso de sucesso: `{ "ok": true, "type": "...", "datetime": "..." }`.

**Montar o atalho no app Atalhos**

1. (Opcional) **Data atual** → **Formatar data** → ISO 8601, se quiser enviar o horário do aparelho em vez do instante do servidor.
2. **Dicionário** com `type` (texto fixo `entrada` ou `saída`) e, se quiser, `datetime` (resultado do passo 1).
3. **Obter conteúdo da URL**
   - URL: a do Worker (`/` ou `/punch`)
   - Método: POST
   - Cabeçalhos: `Authorization` = `Bearer ` + seu token (ou `X-Autoponto-Token`)
   - Corpo da solicitação: **JSON** — o dicionário do passo 2
4. **Mostrar notificação** (ex.: “Ponto registrado”).

Dois atalhos separados (“Bater entrada” / “Bater saída”) com `type` fixo dispensam o passo opcional de data e qualquer pergunta.

**Limite:** dois registros quase simultâneos podem competir (GET → PUT no JSONBin); para uso pessoal é raro.

---

## Desenvolvimento local

1. Copie o exemplo e edite a URL do Worker:
   ```bash
   cp config.local.example.js config.local.js
   ```
2. Em `config.local.js`, defina `WORKER_BASE_URL` com a URL do Worker (`wrangler deploy` ou `wrangler dev`).
3. Sirva a pasta com um servidor HTTP (evite `file://`). Exemplo:
   ```bash
   python -m http.server 8080
   ```
   Acesse `http://localhost:8080`. O `index.html` carrega `config.js` e, fora de `github.io`, tenta `config.local.js` antes de `app.js`.

Se ficar em “Carregando…”, após ~16s aparece erro: confira se o Worker está no ar, se `SESSION_SECRET` e os secrets JSONBin estão definidos no Wrangler, e no Network se as requisições a `/auth/meta`, `/auth/login` ou `/api/bin` retornam 200/401 esperados (CORS é respondido pelo Worker).

---

## Estrutura do bin (JSONBin.io)

O bin armazena um único objeto JSON:

```json
{
  "config": {
    "password": "<hash da senha em SHA-256 ou texto, definido na primeira vez>",
    "balance": {
      "startDate": "2026-03-23",
      "initialBalanceMinutes": 296,
      "weekdayMinutes": 540,
      "fridayMinutes": 480
    },
    "holidaysExtra": [
      { "date": "2026-03-26", "name": "Feriado municipal (exemplo)" }
    ],
    "holidaysRemoved": ["2026-02-16"]
  },
  "records": [
    { "type": "entrada", "datetime": "2025-03-17T08:00:00.000Z" },
    { "type": "saída", "datetime": "2025-03-17T12:00:00.000Z" }
  ]
}
```

- **config.password**: definido na primeira vez que você acessa a página; usado para exibir a tela de login nas próximas vezes.
- **config.balance** (opcional): `startDate` (`YYYY-MM-DD`, primeiro dia incluso na soma trabalhado − esperado), `initialBalanceMinutes` (saldo antes desse dia), `weekdayMinutes` (meta seg–qui), `fridayMinutes` (meta sexta). Se omitido, o app usa os defaults do código (equivalente ao exemplo acima).
- **config.holidaysExtra** (opcional): lista de `{ "date": "YYYY-MM-DD", "name": "..." }` — feriados adicionados na interface (data local).
- **config.holidaysRemoved** (opcional): lista de `YYYY-MM-DD` da semente nacional 2026 que não devem ser tratadas como feriado (nem cor no calendário nem dobro no saldo). A lista fixa de 2026 está em `app.js` (`BR_HOLIDAYS_2026`).
- **records**: lista de registros de ponto; cada item tem `type` (`"entrada"` ou `"saída"`) e `datetime` (ISO 8601). Opcionalmente `source` (`"gps"` pelo atalho, `"manual"` pela web) e `editedInApp` após edição na interface. A página ordena por `datetime` e calcula as horas por dia somando os intervalos entre cada par entrada → saída.

### Migração: todos os registros como GPS (JSONBin)

Se quiser marcar **de uma vez** todos os itens de `records` com `source: "gps"` e remover `editedInApp` (útil para dados antigos), use o script local com os **mesmos** Bin ID e Master Key do Worker (Node.js **18+**):

```powershell
$env:JSONBIN_BIN_ID='seu-bin-id'
# Aspas simples na key: valores com $ são corrompidos em aspas duplas no PowerShell
$env:JSONBIN_MASTER_KEY='sua-master-key-copiada-do-jsonbin'
node scripts/migrate-all-records-gps.js --dry-run
node scripts/migrate-all-records-gps.js
```

O `--dry-run` só mostra quantos registros seriam alterados, sem gravar.

---

## Publicação no GitHub Pages

1. Faça push do código para a branch `main` (ou a branch configurada no workflow).
2. Em **Settings** → **Pages**, escolha **Source: GitHub Actions**.
3. O workflow `Deploy to GitHub Pages` roda a cada push na `main`: gera `config.js` com `AUTOPONTO_WORKER_URL` e publica o site.
4. O site ficará em `https://<seu-usuario>.github.io/<nome-do-repo>/`.

---

## Segurança e limitações

- **Repositório e site:** o bundle publicado no Pages contém só `WORKER_BASE_URL` (pública). Master Key, Bin ID, `SESSION_SECRET` e `SHORTCUT_TOKEN` ficam nos secrets da Cloudflare (Worker).
- **Sessão web:** JWT de curta duração (7 dias) em `sessionStorage`; não dá para simular login só alterando `localStorage` como antes.
- **Riscos residuais:** quem controlar o HTML/JS do site (XSS ou fork malicioso) pode roubar o JWT na sessão. Quem tiver o **SHORTCUT_TOKEN** continua podendo **só adicionar** pontos pelo POST do atalho; não substitui a senha da interface. Não versione tokens; troque se vazarem.
