# Changelog

Alterações notáveis do projeto. A versão do app está em `config.json` (campo `version`).

## [1.0.21] - 2026-03-30

### Adicionado

- **Calendário:** no card do dia, exibição do **nome do feriado** quando a data está ativa no mapa (semente 2026 ou manual).

### Alterado

- **GPS / batidas espúrias:** pares **consecutivos** no tempo (todos os registros ordenados por data/hora **real**) do tipo entrada seguida de saída ou o inverso, com intervalo **menor que 5 minutos** (sem usar o ajuste de ±2 min), **não aparecem** na lista do dia, **não entram** no total do dia nem no saldo; os registros **continuam salvos** no JSONBin.

## [1.0.20] - 2026-03-30

### Alterado

- **Calendário em telas estreitas:** células mantêm largura mínima (~7,5rem por coluna); a grade passa a ter **rolagem horizontal** em vez de comprimir os cards e quebrar muito o texto. Removido `flex-wrap` nas linhas de registro no breakpoint mobile.

## [1.0.19] - 2026-03-30

### Adicionado

- **Feriados 2026 (Brasil):** semente no app com feriados nacionais e móveis (Carnaval, Sexta Santa, Corpus Christi, etc.); destaque visual no calendário; aba **Feriados** para feriados manuais e para ignorar/restaurar entradas da semente (`config.holidaysExtra`, `config.holidaysRemoved`).
- **Saldo:** em **domingo** ou em **feriado ativo**, as horas trabalhadas contam **em dobro** apenas no cálculo do saldo (o total exibido por dia permanece o tempo real); dica “(2× saldo)” quando aplicável.

## [1.0.18] - 2026-03-26

### Segurança / arquitetura

- **Site → Worker → JSONBin:** a interface não chama mais o JSONBin no navegador; Master Key e Bin ID ficam só nos secrets do Cloudflare Worker. O `config.js` publicado contém apenas `WORKER_BASE_URL` (secret `AUTOPONTO_WORKER_URL` no GitHub).
- **Sessão:** login com JWT assinado no Worker (`SESSION_SECRET`); token em `sessionStorage` (não é possível “entrar” só com flag em `localStorage`). Logout e expiração limpam a sessão.

### Alterado

- Workflow do Pages: removidos `JSONBIN_BIN_ID` / `JSONBIN_MASTER_KEY` da geração do site; adicionado `AUTOPONTO_WORKER_URL`.
- Desenvolvimento local: `config.local.js` com `WORKER_BASE_URL`; exemplo em `config.local.example.js`.

## [1.0.17] - 2026-03-24

### Alterado

- **Saldo na barra:** exibido como **até ontem** (data local), não mais até hoje.
- **Saldo por dia:** cada célula do calendário mostra o saldo cumulativo ao fim daquele dia; em **hoje** e dias futuros mostra **—** (alinhado ao saldo “fechado” do topo).

## [1.0.16] - 2026-03-24

### Adicionado

- **Saldo de horas** na barra do calendário (cumulativo até hoje): saldo inicial **+4h56** antes de **2026-03-23**; a partir dessa data, soma **(trabalhado − esperado)** por dia na **data local**, com meta **9h** de segunda a quinta, **8h** na sexta e **0** no fim de semana. Parâmetros em `config.balance` no JSONBin (valores padrão aplicados se ausentes; normalizados ao salvar).

## [1.0.15] - 2026-03-24

### Alterado

- Ajuste de horário efetivo no calendário e nos totais: **entrada +2 minutos** e **saída −2 minutos** (antes +5/−5). O valor armazenado no JSONBin continua sendo o horário real.

## [1.0.14] - 2026-03-20

### Alterado

- Cálculo e exibição no calendário: **entrada** considera horário efetivo **+5 minutos** e **saída** **−5 minutos** em relação ao horário registrado (valor salvo no JSONBin permanece o horário real; edição no modal continua mostrando o registro bruto).

## [1.0.13] - 2026-03-20

### Alterado

- Documentação: URL pública do Worker em produção (`https://autoponto-punch.reiser-gui.workers.dev`) no README principal, README do worker e `AGENTS.md`.

## [1.0.12] - 2026-03-20

### Alterado

- Documentação do atalho iOS unificada: apenas o fluxo via **Cloudflare Worker** (POST); removidos os passos do atalho direto no JSONBin (GET/PUT). README principal, `AGENTS.md` e README do worker ajustados.

## [1.0.11] - 2026-03-20

### Adicionado

- Worker **Cloudflare** em `workers/autoponto-punch/`: endpoint **POST** com token (`Authorization: Bearer` ou `X-Autoponto-Token`) que lê o bin no JSONBin, acrescenta registro (`type` + `datetime`), ordena `records` e faz PUT — simplifica o atalho iOS e evita guardar a Master Key no telefone.
- Documentação no README, README do worker com Wrangler/secrets, e nota de segurança sobre o token do atalho.

## [1.0.10] - 2026-03-17

### Corrigido

- Agrupamento de registros por dia ajustado para usar **data local** (fuso do navegador), em vez de `YYYY-MM-DD` direto do ISO UTC. Isso corrige casos em que entrada/saída apareciam no dia errado e o total ficava "—".
- Edição de ponto com `datetime-local` ajustada para preencher com data/hora local (sem deslocamento por timezone).
- Ordenação e renderização dos registros ficaram mais robustas para datas inválidas e tipos de ponto normalizados (`entrada`, `saída`, `saida`).

## [1.0.9] - 2026-03-17

### Corrigido

- Total do dia não era calculado quando havia um par entrada/saída com tipo "saida" (sem acento): passamos a normalizar o tipo (`saida`/`saída` → `saída`).
- Total do dia também não era calculado quando a saída vinha antes da entrada no mesmo dia (ex.: S 21:06 e E 09:00): para um único par entrada+saída no dia, o total passa a ser a diferença entre o horário da saída e o da entrada, independente da ordem.

## [1.0.8] - 2026-03-17

### Adicionado

- Total de horas trabalhadas por dia exibido com rótulo "Total:" em cada célula do calendário.
- Total do mês na barra de navegação do calendário ("Total do mês: Xh Ymin").

### Alterado

- Ao clicar em "+ Ponto" de um dia, o campo data/hora do modal passa a vir preenchido com a **data daquele dia** e horário padrão 08:00, em vez da data/hora atual.

## [1.0.7] - 2026-03-17

### Corrigido

- Resposta do GET ao JSONBin com `X-Bin-Meta: false`: quando a API devolve o conteúdo do bin direto (sem wrapper `record`), o app passa a usar esse objeto como config/records, evitando mostrar sempre "Primeira vez: defina uma senha" mesmo com senha já salva no bin.

## [1.0.6] - 2026-03-17

### Corrigido

- Login passa a persistir ao reabrir a página: estado "logado" guardado em `localStorage` em vez de `sessionStorage`, assim o acesso permanece mesmo após fechar a aba ou o navegador.

## [1.0.5] - 2026-03-17

### Corrigido

- Mensagem "Carregando…" deixou de ficar visível por cima do calendário: `#screen-loading` agora usa `display: none` por padrão e só `display: flex` quando tem a classe `.active`, evitando que a regra por ID sobrescreva o ocultamento da tela.

## [1.0.4] - 2026-03-17

### Corrigido

- Compatibilidade de JavaScript melhorada: removido uso de optional chaining (`?.`) na inicialização dos eventos, evitando erro de parsing em navegadores mais antigos que deixava a tela presa em "Carregando…".

## [1.0.3] - 2026-03-17

### Corrigido

- Em produção (GitHub Pages) o `config.local.js` não é mais solicitado: carregamento condicional por hostname (`github.io`), eliminando o 404 e a mensagem no console "Falha no carregamento do script config.local.js".

## [1.0.2] - 2026-03-17

### Corrigido

- Failsafe de 16s: se a página continuar em "Carregando…", após 16 segundos a tela de erro é exibida automaticamente, evitando travamento.
- Timeout do GET ao JSONBin feito com `Promise.race` (12s) em vez de AbortController, para maior compatibilidade.
- Função `showError` centralizada e try/catch em volta de `init()` para erros síncronos.

## [1.0.1] - 2026-03-17

### Corrigido

- Página travando em "Carregando…" no GitHub Pages: ordem dos scripts alterada para carregar `config.js` antes de `config.local.js` (evita 404 do config.local em produção).
- Timeout de 15s na requisição GET ao JSONBin: em caso de demora ou falha de rede, exibe tela de erro em vez de ficar travado.
- Mensagens de erro mais claras: bin não encontrado (404), tempo esgotado e falha de conexão/rede.

## [1.0.0] - 2025-03-17

### Adicionado

- Aplicativo estático de controle de ponto para GitHub Pages.
- Persistência dos dados em JSONBin.io (estrutura `config` + `records`).
- Deploy via GitHub Actions com injeção de Bin ID e API Key por GitHub Secrets (`config.template.js` → `config.js`).
- Tela de senha: definir na primeira vez e login nas próximas (hash SHA-256 em `config.password`).
- Calendário mensal com navegação por mês/ano.
- Por dia: lista de registros (entrada/saída) e cálculo de horas trabalhadas (soma dos intervalos entre pares entrada → saída).
- Edição de horário e tipo, exclusão e adição manual de registros; persistência com PUT no JSONBin.
- Documentação no README: configuração dos Secrets no GitHub e atalho no iPhone para registro de ponto.
