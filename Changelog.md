# Changelog

Alterações notáveis do projeto. A versão do app está em `config.json` (campo `version`).

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
