# Changelog

Alterações notáveis do projeto. A versão do app está em `config.json` (campo `version`).

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
- Documentação no README: configuração dos Secrets no GitHub e passo a passo do Shortcut no iPhone para registrar ponto direto no JSONBin.
