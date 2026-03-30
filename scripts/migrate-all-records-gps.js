/**
 * Migração pontual: marca **todos** os itens em `records` com `source: 'gps'`
 * e remove `editedInApp`, para o calendário exibir só o ícone de GPS.
 *
 * Não altera `config` (senha, feriados, comentários por dia, etc.).
 *
 * Uso (PowerShell), com os mesmos valores dos secrets do Worker.
 * **Importante:** use aspas simples na Master Key se ela contiver `$`
 * (em aspas duplas o PowerShell interpreta `$` como variável e estraga o valor):
 *
 *   $env:JSONBIN_BIN_ID='seu-bin-id'
 *   $env:JSONBIN_MASTER_KEY='$2a$10$...'
 *   node scripts/migrate-all-records-gps.js
 *   node scripts/migrate-all-records-gps.js --dry-run
 *
 * Com `--dry-run` só mostra quantos registros seriam alterados, sem PUT.
 *
 * Exige Node.js 18+ (fetch nativo).
 */

'use strict';

var dryRun = process.argv.indexOf('--dry-run') !== -1;

function parseBinPayload(data) {
  if (data && data.record != null) return data.record;
  if (data && (typeof data.config !== 'undefined' || typeof data.records !== 'undefined')) {
    return data;
  }
  return { config: {}, records: [] };
}

async function main() {
  var binId = process.env.JSONBIN_BIN_ID;
  var masterKey = process.env.JSONBIN_MASTER_KEY;
  if (!binId || !masterKey || !String(binId).trim() || !String(masterKey).trim()) {
    console.error('Defina JSONBIN_BIN_ID e JSONBIN_MASTER_KEY no ambiente.');
    process.exit(1);
  }

  var base = 'https://api.jsonbin.io/v3/b';
  var getRes = await fetch(base + '/' + binId + '/latest', {
    headers: {
      'X-Master-Key': masterKey,
      'X-Bin-Meta': 'false'
    }
  });

  if (!getRes.ok) {
    console.error('Falha ao ler o bin:', getRes.status, await getRes.text().catch(function () { return ''; }));
    process.exit(1);
  }

  var getData = await getRes.json();
  var record = parseBinPayload(getData);
  var config = record.config && typeof record.config === 'object' ? record.config : {};
  var records = Array.isArray(record.records) ? record.records : [];

  var next = records.map(function (r) {
    if (!r || typeof r !== 'object') return r;
    var out = {};
    var k;
    for (k in r) {
      if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k];
    }
    out.source = 'gps';
    delete out.editedInApp;
    return out;
  });

  if (dryRun) {
    console.log('[dry-run] Seriam atualizados ' + next.length + ' registro(s) com source: "gps" (editedInApp removido). Nada foi gravado.');
    return;
  }

  var putRes = await fetch(base + '/' + binId, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': masterKey
    },
    body: JSON.stringify({ config: config, records: next })
  });

  if (!putRes.ok) {
    console.error('Falha ao gravar o bin:', putRes.status, await putRes.text().catch(function () { return ''; }));
    process.exit(1);
  }

  console.log('Concluído: ' + next.length + ' registro(s) com source: "gps" (editedInApp removido).');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
