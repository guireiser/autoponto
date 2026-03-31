# autoponto-punch (Cloudflare Worker)

Proxy entre o **Autoponto** e o [JSONBin.io](https://jsonbin.io): o atalho iOS envia **POST** com token; a **interface web** usa **sessão JWT** para ler e gravar o bin sem expor Master Key nem Bin ID no navegador.

## Pré-requisitos

- Conta [Cloudflare](https://dash.cloudflare.com/) (plano gratuito)
- Node.js (para `npx wrangler`)
- Bin no JSONBin com formato `{ "config": {}, "records": [] }`

## Configuração de secrets

Na pasta deste worker:

```bash
npx wrangler login
npx wrangler secret put JSONBIN_BIN_ID
npx wrangler secret put JSONBIN_MASTER_KEY
npx wrangler secret put SHORTCUT_TOKEN
npx wrangler secret put SESSION_SECRET
```

- **JSONBIN_BIN_ID** / **JSONBIN_MASTER_KEY:** mesmos valores usados para acessar o bin (não vão para o GitHub Pages).
- **SHORTCUT_TOKEN:** string longa e aleatória; o atalho iOS envia no header.
- **SESSION_SECRET:** string longa e aleatória (ex.: `openssl rand -hex 32`); usada para assinar JWT da interface web. **Obrigatória** para login e para `GET`/`PUT` `/api/bin`.

## Deploy

```bash
cd workers/autoponto-punch
npx wrangler deploy
```

Anote a URL exibida (ex.: `https://autoponto-punch.<subdomínio>.workers.dev`). Essa URL deve ir para o secret **`AUTOPONTO_WORKER_URL`** no GitHub (Pages) — URL do Worker “principal” — e para `WORKER_BASE_URL` em `config.local.js` no desenvolvimento local.

**Segundo bin / outro hostname no site (ex.: `a.greiser.dev`):** faça outro deploy (outro nome de serviço no `wrangler.toml`), secrets apontando para o **outro** bin JSONBin, e registre a URL desse Worker no secret opcional **`AUTOPONTO_WORKER_BY_HOST`** do GitHub, por exemplo `{"a.greiser.dev":"https://esse-outro.workers.dev"}`. O atalho iOS dessa pessoa continua usando a URL do **Worker** dela, não a do site.

### URL em produção (deploy deste projeto)

- **Base:** [`https://autoponto-punch.reiser-gui.workers.dev`](https://autoponto-punch.reiser-gui.workers.dev)

Quem clonar o repositório e fizer deploy na própria conta terá outro subdomínio.

---

## Atalho iPhone (POST)

- **POST** `/` ou `/punch`
- Header: `Authorization: Bearer <SHORTCUT_TOKEN>` **ou** `X-Autoponto-Token: <SHORTCUT_TOKEN>`
- Corpo JSON: `type` (`entrada`, `saída` ou `saida`); `datetime` opcional (ISO 8601)
- **Origem no bin** (opcional):
  - **Omissão** (atalho “normal”): grava com **`source: 'gps'`** (ícone de GPS no app).
  - **Manual:** inclua **`"source": "manual"`** ou **`"manual": true`** no mesmo JSON — grava com **`source: 'manual'`** (ícone de lápis), para atalhos “entrada/saída manual” no iPhone.

Resposta `200`: `{ "ok": true, "type": "...", "datetime": "...", "source": "gps" | "manual" }`.

---

## Interface web (CORS)

Todas as rotas abaixo respondem a `OPTIONS` com CORS. Origem refletida a partir do header `Origin` (quando presente).

| Rota | Método | Autenticação | Descrição |
|------|--------|--------------|-----------|
| `/auth/meta` | GET | — | `{ "hasPassword": true \| false }`. `Cache-Control: no-store`. |
| `/auth/login` | POST | — | Corpo `{ "password": "..." }`. Resposta `{ "ok": true, "token": "<JWT>", "record": { "config", "records" } }` sem `config.password`. |
| `/auth/setup` | POST | — | Só se ainda **não** existir senha no bin. Corpo `{ "password": "..." }`; grava hash SHA-256 e devolve token + record (sanitizado). |
| `/api/bin` | GET | `Authorization: Bearer <JWT>` | `{ "ok": true, "record": { "config", "records" } }` sem `config.password`. |
| `/api/bin` | PUT | `Authorization: Bearer <JWT>` | Corpo `{ "config", "records" }`. O Worker **preserva** `config.password` do bin atual (o cliente não pode trocá-la por este canal). |

Erros comuns: `401` (JWT inválido/expirado ou senha errada), `409` em `/auth/setup` se a senha já existir, `503` se faltar secret no Worker.

**Validade do JWT:** 7 dias (`exp`).

---

## Limite

Requisições concorrentes (dois POSTs do atalho ou PUT + POST) podem competir (GET → modificar → PUT). Para uso pessoal costuma ser raro.

## Documentação do projeto

Instruções do atalho iOS e do Pages estão no [README.md](../../README.md) na raiz do repositório.
