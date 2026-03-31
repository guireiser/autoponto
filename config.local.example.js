// Copie para config.local.js (não versionado) e preencha as URLs dos Workers após `npx wrangler deploy`.
// Resolução da URL do Worker (em ordem): prefixo de path → hostname → WORKER_BASE_URL.
// Opcional: WORKER_BASE_URL_BY_PATH — se location.pathname bate no prefixo (mais longo primeiro), usa esse Worker.
//   Ex.: { "/a": "https://..." } — acesse https://seu-dominio/a (evite /a/ com barra final se os assets quebrarem).
// Opcional: WORKER_BASE_URL_BY_HOST — hostname em minúsculas → Worker (útil se o Pages aceitar outro host).
window.APP_CONFIG = {
  WORKER_BASE_URL: 'https://seu-worker-principal.subdominio.workers.dev',
  WORKER_BASE_URL_BY_PATH: {
    // '/a': 'https://seu-worker-segundo.subdominio.workers.dev'
  },
  WORKER_BASE_URL_BY_HOST: {}
};
