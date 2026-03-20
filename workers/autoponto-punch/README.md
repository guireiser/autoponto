# autoponto-punch (Cloudflare Worker)

Proxy para registrar **entrada** / **saída** no mesmo bin do [JSONBin.io](https://jsonbin.io) usado pelo Autoponto, com um único **POST** — usado pelo atalho no iPhone sem expor a Master Key no dispositivo.

## Pré-requisitos

- Conta [Cloudflare](https://dash.cloudflare.com/) (plano gratuito)
- Node.js (para `npx wrangler`)
- Bin no JSONBin com formato `{ "config": {}, "records": [] }` (igual ao app)

## Configuração de secrets

Na pasta deste worker:

```bash
npx wrangler login
npx wrangler secret put JSONBIN_BIN_ID
npx wrangler secret put JSONBIN_MASTER_KEY
npx wrangler secret put SHORTCUT_TOKEN
```

- **JSONBIN_BIN_ID** e **JSONBIN_MASTER_KEY**: os mesmos valores dos Secrets do GitHub (`JSONBIN_BIN_ID`, `JSONBIN_MASTER_KEY`).
- **SHORTCUT_TOKEN**: uma string longa e aleatória (ex.: gerada por um gerenciador de senhas). O atalho do iOS envia esse token no header; quem não tiver o token não consegue gravar ponto.

## Deploy

```bash
cd workers/autoponto-punch
npx wrangler deploy
```

Anote a URL exibida (ex.: `https://autoponto-punch.<subdomínio>.workers.dev`).

### URL em produção (deploy deste projeto)

- **Base:** [`https://autoponto-punch.reiser-gui.workers.dev`](https://autoponto-punch.reiser-gui.workers.dev)
- **POST:** mesma base com `/` ou `/punch` (ex.: `…/punch`).

Quem clonar o repositório e fizer deploy na própria conta terá outro subdomínio; o atalho deve apontar para a URL do seu Worker.

## Contrato HTTP

- **POST** `/` ou `/punch`
- Header: `Authorization: Bearer <SHORTCUT_TOKEN>` **ou** `X-Autoponto-Token: <SHORTCUT_TOKEN>`
- Corpo JSON:
  - `type` (obrigatório): `entrada`, `saída` ou `saida`
  - `datetime` (opcional): ISO 8601; se omitido, usa o instante no Worker (UTC)

Resposta `200`: `{ "ok": true, "type": "...", "datetime": "..." }`.

`OPTIONS` responde com CORS para testes no navegador (o app Atalhos não depende disso).

## Limite

Dois POSTs quase ao mesmo tempo podem sobrescrever um ao outro (padrão GET → modificar → PUT). Para uso pessoal costuma ser raro.

## Documentação do projeto

Instruções completas do atalho iOS e contexto estão no [README.md](../../README.md) na raiz do repositório.
