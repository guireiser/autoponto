// Copie para config.local.js (não versionado) e preencha as URLs dos Workers após `npx wrangler deploy`.
// Opcional: WORKER_BASE_URL_BY_HOST — quando o hostname da página está neste mapa, usa a URL indicada
// (útil para a.greiser.dev → segundo bin/Worker). Chaves em minúsculas.
window.APP_CONFIG = {
  WORKER_BASE_URL: 'https://seu-worker-principal.subdominio.workers.dev',
  WORKER_BASE_URL_BY_HOST: {
    // 'a.greiser.dev': 'https://seu-worker-segundo.subdominio.workers.dev'
  }
};
