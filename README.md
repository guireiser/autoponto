# Autoponto

Aplicativo estático de controle de ponto de trabalho para publicar no GitHub Pages. Os dados são persistidos em um bin no [JSONBin.io](https://jsonbin.io). Inclui tela de calendário com registros por dia, cálculo de horas trabalhadas (entrada/saída), senha de acesso e suporte a registro de ponto via Shortcut no iPhone.

## Funcionalidades

- **Calendário mensal** com registros de entrada e saída por dia
- **Total de horas por dia** (rótulo "Total:" em cada dia) e **total do mês** na barra de navegação
- **Cálculo de horas trabalhadas** por dia (soma dos intervalos entre cada par entrada → saída), com agrupamento por data local do navegador (evita deslocamento de dia por UTC)
- **Edição manual**: adicionar, editar horário e excluir registros (ao adicionar ponto em um dia, a data do dia já vem preenchida)
- **Senha de acesso** à página (definida na primeira vez e armazenada no bin)
- **Deploy no GitHub Pages** com API Key e Bin ID injetados por GitHub Secrets (não ficam no repositório)
- **Shortcut no iPhone** para registrar entrada/saída direto no JSONBin (documentado abaixo)

## Pré-requisitos

- Conta no [JSONBin.io](https://jsonbin.io) (plano gratuito)
- Repositório no GitHub com GitHub Pages habilitado via **GitHub Actions**

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

## Shortcut no iPhone

Como o GitHub Pages só serve arquivos estáticos, não há um endpoint POST no site. O Shortcut fala **direto com o JSONBin.io**: faz GET no bin, adiciona o registro de entrada ou saída e faz PUT de volta.

### Passo a passo no app Atalhos

1. **Obter horário atual em ISO**  
   Use a ação “Data atual” e formate como texto (formato ISO, ex.: `2025-03-17T14:30:00.000Z`). No Atalhos você pode usar “Formatar data” com “ISO 8601” ou montar a string manualmente.

2. **Perguntar o tipo**  
   Use “Perguntar” com opções “Entrada” e “Saída”, ou crie dois atalhos separados (“Bater Entrada” e “Bater Saída”) e defina o tipo fixo em cada um.

3. **GET no bin**  
   - Ação: **Obter conteúdo da URL**
   - URL: `https://api.jsonbin.io/v3/b/<SEU_BIN_ID>/latest`
   - Método: GET
   - Cabeçalhos: adicione `X-Master-Key` com valor da sua Master Key (e opcionalmente `X-Bin-Meta` = `false` para não trazer metadados).

4. **Interpretar o JSON**  
   Use “Obter valor de Dicionário” (ou “Obter dicionário de entrada”): da resposta, pegue o valor da chave `record`. Depois, de `record`, pegue as chaves `config` e `records` (a lista de registros).

5. **Adicionar o novo registro**  
   Crie um dicionário com:
   - `type`: o texto “entrada” ou “saída” (conforme o passo 2)
   - `datetime`: o horário em ISO do passo 1  
   Adicione esse dicionário à lista `records` (use “Adicionar à lista” ou equivalente). Mantenha a lista ordenada por data se quiser (opcional; a página reordena ao exibir).

6. **Montar o corpo do PUT**  
   Monte um dicionário com:
   - `config`: o mesmo objeto `config` obtido no passo 4 (para não perder a senha)
   - `records`: a lista atualizada do passo 5

7. **PUT no bin**  
   - Ação: **Obter conteúdo da URL**
   - URL: `https://api.jsonbin.io/v3/b/<SEU_BIN_ID>`
   - Método: PUT
   - Cabeçalhos: `X-Master-Key` (sua key), `Content-Type` = `application/json`
   - Corpo da solicitação: o dicionário do passo 6 convertido em JSON (use “Texto” ou “Mostrar resultado” do dicionário em JSON).

8. **Confirmação**  
   Use “Mostrar notificação” ou “Mostrar alerta” com texto “Entrada registrada” ou “Saída registrada” conforme o tipo.

### Resumo da API usada pelo Shortcut

- **GET** `https://api.jsonbin.io/v3/b/<BIN_ID>/latest`  
  Cabeçalho: `X-Master-Key: <SUA_KEY>`  
  Resposta: `{ "record": { "config": {...}, "records": [...] } }`

- **PUT** `https://api.jsonbin.io/v3/b/<BIN_ID>`  
  Cabeçalhos: `X-Master-Key`, `Content-Type: application/json`  
  Corpo: `{ "config": {...}, "records": [...] }`

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
