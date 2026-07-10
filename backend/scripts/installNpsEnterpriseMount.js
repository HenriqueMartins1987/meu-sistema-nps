'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const mountLine = "app.use('/nps/enterprise', require('./routes/npsEnterpriseStandaloneRouter'));";

if (!fs.existsSync(serverPath)) {
  throw new Error(`server.js não encontrado em ${serverPath}`);
}

const source = fs.readFileSync(serverPath, 'utf8');

if (source.includes(mountLine)) {
  console.log('NPS Enterprise já está montado no server.js. Nenhuma alteração necessária.');
  process.exit(0);
}

const appAnchor = source.indexOf('const app = express();');
if (appAnchor < 0) {
  throw new Error('Não foi possível localizar a criação do app Express.');
}

const routeRegex = /\n\s*app\.(get|post|put|patch|delete)\s*\(/g;
routeRegex.lastIndex = appAnchor;
const firstRoute = routeRegex.exec(source);

if (!firstRoute) {
  throw new Error('Não foi possível localizar a primeira rota Express para inserir o mount com segurança.');
}

const insertionIndex = firstRoute.index + 1;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${serverPath}.bak-nps-enterprise-${timestamp}`;
fs.copyFileSync(serverPath, backupPath);

const next = [
  source.slice(0, insertionIndex),
  '// NPS Enterprise Management Layer\n',
  `${mountLine}\n\n`,
  source.slice(insertionIndex)
].join('');

fs.writeFileSync(serverPath, next, 'utf8');

console.log(JSON.stringify({
  success: true,
  serverPath,
  backupPath,
  mountLine
}, null, 2));
