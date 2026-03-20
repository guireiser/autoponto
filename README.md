# Autoponto

Aplicativo estático de controle de ponto de trabalho para publicar no GitHub Pages. Os dados são persistidos em um bin no [JSONBin.io](https://jsonbin.io). Inclui tela de calendário com registros por dia, cálculo de horas trabalhadas (entrada/saída), senha de acesso e registro de ponto pelo **Atalhos** no iPhone via **Cloudflare Worker** (POST com token).

## Funcionalidades

- **Calendário mensal** com registros de entrada e saída por dia
- **Total de horas por dia** (rótulo "Total:" em cada dia) e **total do mês** na barra de navegação
- **Cálculo de horas trabalhadas** por dia (soma dos intervalos entre cada par entrada → saída), com agrupamento por data local do navegador (evita deslocamento de dia por UTC)
- **Edição manual**: adicionar, editar horário e excluir registros (ao adicionar ponto em um dia, a data do dia já vem preenchida)
- **Senha de acesso** à página (definida na primeira vez e armazenada no bin)
- **Deploy no GitHub Pages** com API Key e Bin ID injetados por GitHub Secrets (não ficam no repositório)
- **Shortcut no iPhone** para registrar entrada/saída pelo Worker (POST; documentado abaixo)

## Pré-requisitos

- Conta no [JSONBin.io](https://jsonbin.io) (plano gratuito)
- Repositório no GitHub com GitHub Pages habilitado via **GitHub Actions**
- Para o atalho no iPhone: conta na [Cloudflare](https://dash.cloudflare.com/) (plano gratuito) e deploy do Worker em [`workers/autoponto-punch/`](workers/autoponto-punch/) — ver [README do worker](workers/autoponto-punch/README.md)

## Configurar Secrets no GitHub

Para não expor a API Key e o Bin ID no repositório público, use **GitHub Secrets**. O workflow de deploy gera `config.js` em tempo de build a partir dos secrets.

### 1. Criar conta e bin no JSONBin.io

1. Acesse [jsonbin.io](https://jsonbin.io) e crie uma conta (se necessário).
2. Crie um novo bin com o corpo inicial:
   ```json
   { "config": {}, "records": [] }
   ```
3. Anote:
   - **Bin ID** (ex.: `65f1234567890abcdef12345`) — aparece na URL ou na resposta da API
   - **Master Key** ou uma Access Key com permissão de leitura e escrita — em [API Keys](https://jsonbin.io/app/api-keys)

### 2. Abrir os Secrets do repositório no GitHub

1. No repositório, vá em **Settings** → **Secrets and variables** → **Actions**.

### 3. Criar os Secrets

1. Clique em **New repository secret**.
2. Crie dois secrets (os nomes devem ser exatamente estes):
   - **Nome:** `JSONBIN_BIN_ID` → **Valor:** o Bin ID anotado.
   - **Nome:** `JSONBIN_MASTER_KEY` → **Valor:** a Master Key (ou Access Key) do JSONBin.

### 4. Não commitar a key

Nunca coloque a Master Key ou o Bin ID em arquivos versionados. O único arquivo de config versionado é `config.template.js`, que contém apenas placeholders `{{BIN_ID}}` e `{{API_KEY}}`. O workflow substitui esses placeholders pelos valores dos Secrets no momento do deploy.

### 5. Rodar o deploy

Após salvar os Secrets, o próximo push na branch `main` dispara o workflow: ele gera `config.js` e publica o site no GitHub Pages. Em **Settings** → **Pages**, defina a fonte como **GitHub Actions** (não “Deploy from a branch”).

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

1. Copie o template de configuração:
   ```bash
   cp config.template.js config.local.js
   ```
2. Edite `config.local.js` e substitua os placeholders pelos seus valores:
   - `{{BIN_ID}}` → seu Bin ID
   - `{{API_KEY}}` → sua Master Key do JSONBin
3. Abra `index.html` em um servidor local (o navegador pode bloquear requisições a APIs a partir de `file://`). Exemplo com Python:
   ```bash
   python -m http.server 8080
   ```
  Acesse `http://localhost:8080`. A página carrega primeiro `config.js` e depois `config.local.js` (se existir); localmente você usa `config.local.js` e não versiona `config.js` (está no `.gitignore`). Se a página ficar em "Carregando…" no GitHub Pages, após no máximo 16 segundos aparece uma mensagem de erro. Verifique: (1) o bin existe no JSONBin.io com o BIN_ID igual ao secret `JSONBIN_BIN_ID`; (2) o corpo do bin é `{ "config": {}, "records": [] }`; (3) abra F12 → Aba Rede/Network, recarregue a página e veja se a requisição a `api.jsonbin.io` aparece e qual o status (CORS, 404, 401, etc.). Em navegadores mais antigos, erros de parsing de JavaScript também podem impedir a inicialização; mantenha o navegador atualizado.

---

## Estrutura do bin (JSONBin.io)

O bin armazena um único objeto JSON:

```json
{
  "config": {
    "password": "<hash da senha em SHA-256 ou texto, definido na primeira vez>"
  },
  "records": [
    { "type": "entrada", "datetime": "2025-03-17T08:00:00.000Z" },
    { "type": "saída", "datetime": "2025-03-17T12:00:00.000Z" }
  ]
}
```

- **config.password**: definido na primeira vez que você acessa a página; usado para exibir a tela de login nas próximas vezes.
- **records**: lista de registros de ponto; cada item tem `type` (`"entrada"` ou `"saída"`) e `datetime` (ISO 8601). A página ordena por `datetime` e calcula as horas por dia somando os intervalos entre cada par entrada → saída.

---

## Publicação no GitHub Pages

1. Faça push do código para a branch `main` (ou a branch configurada no workflow).
2. Em **Settings** → **Pages**, escolha **Source: GitHub Actions**.
3. O workflow `Deploy to GitHub Pages` roda a cada push na `main`: gera `config.js` a partir dos Secrets e publica o site.
4. O site ficará em `https://<seu-usuario>.github.io/<nome-do-repo>/`.

---

## Segurança e limitações

- **Repositório público:** a API Key e o Bin ID não ficam no código; são injetados em tempo de deploy via GitHub Secrets.
- **Site publicado:** o JavaScript do site ainda contém a key no front-end (quem inspecionar o site no navegador pode vê-la). A proteção dos Secrets evita que a key apareça no repositório.
- A **senha** no bin protege apenas o acesso à interface; quem tiver a key pode ler/editar o bin diretamente pela API.
- Com o **Worker**, quem tiver só o `SHORTCUT_TOKEN` pode **adicionar** registros (o Worker faz GET/PUT com a Master Key). Não versione esse token; troque-o se vazar. O token não substitui a senha da interface web.
