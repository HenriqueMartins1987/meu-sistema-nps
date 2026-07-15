const fs = require('fs');

const queueFile =
  'runtime/ecuro-db/ecuro-nps-queue.json';

if (!fs.existsSync(queueFile)) {
  console.error({
    status:
      'QUEUE_FILE_NOT_FOUND'
  });

  process.exit(1);
}

const stat =
  fs.statSync(queueFile);

const now =
  Date.now();

const ageHours =
  Math.round(
    ((now - stat.mtime.getTime()) / 36_000) 
  ) / 100;

const queue =
  JSON.parse(
    fs.readFileSync(queueFile, 'utf8')
  );

console.log({
  status:
    'QUEUE_FRESHNESS',
  modifiedAt:
    stat.mtime.toISOString(),
  ageHours,
  totalQueue:
    queue.length
});

if (ageHours > 24) {
  console.error({
    status:
      'QUEUE_STALE_BLOCK_SEND',
    message:
      'Fila NPS com mais de 24 horas. Bloquear envio.'
  });

  process.exit(1);
}

if (!queue.length) {
  console.error({
    status:
      'QUEUE_EMPTY_BLOCK_SEND',
    message:
      'Fila NPS vazia. Bloquear envio.'
  });

  process.exit(1);
}
