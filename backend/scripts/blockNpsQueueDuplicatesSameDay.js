const fs =
  require('fs');

const path =
  require('path');

const queueFile =
  path.join(
    __dirname,
    '..',
    'runtime',
    'ecuro-db',
    'ecuro-nps-queue.json'
  );

function normalizePhone(value) {
  return String(
    value || ''
  ).replace(
    /\D/g,
    ''
  );
}

function normalizeCode(value) {
  return String(
    value || ''
  )
    .trim()
    .toUpperCase()
    .replace(
      /\s+/g,
      ''
    );
}

function dateOnly(value) {
  if (
    !value
  ) {
    return '';
  }

  const text =
    String(
      value
    ).trim();

  const match =
    text.match(
      /^\d{4}-\d{2}-\d{2}/
    );

  if (
    match
  ) {
    return match[0];
  }

  const parsed =
    new Date(
      text
    );

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return '';
  }

  return parsed
    .toISOString()
    .slice(
      0,
      10
    );
}

function getItemDate(item) {
  return (
    dateOnly(
      item.targetDate
    ) ||
    dateOnly(
      item.scheduledDate
    ) ||
    dateOnly(
      item.lastConsultationDate
    ) ||
    dateOnly(
      item.createdAt
    ) ||
    dateOnly(
      item.sentAt
    ) ||
    new Date()
      .toISOString()
      .slice(
        0,
        10
      )
  );
}

if (
  !fs.existsSync(
    queueFile
  )
) {
  console.log({
    status:
      'QUEUE_FILE_NOT_FOUND'
  });

  process.exit(0);
}

const queue =
  JSON.parse(
    fs.readFileSync(
      queueFile,
      'utf8'
    )
  );

const sortedIndexes =
  queue
    .map(
      (item, index) => ({
        item,
        index,
        time:
          new Date(
            item.createdAt ||
            item.updatedAt ||
            item.sentAt ||
            0
          ).getTime()
      })
    )
    .sort(
      (a, b) =>
        b.time - a.time
    );

const seen =
  new Map();

let duplicates =
  0;

for (
  const row of sortedIndexes
) {
  const item =
    row.item;

  const phone =
    normalizePhone(
      item.patientPhone ||
      item.whatsappPhone ||
      item.phone
    );

  const clinicCode =
    normalizeCode(
      item.clinicCode ||
      item.unitCode ||
      item.codigoClinica ||
      item.unidadeCodigo
    );

  const day =
    getItemDate(
      item
    );

  if (
    !phone ||
    !clinicCode ||
    !day
  ) {
    continue;
  }

  const key =
    `${clinicCode}|${phone}|${day}`;

  if (
    !seen.has(
      key
    )
  ) {
    seen.set(
      key,
      row.index
    );

    continue;
  }

  const stage =
    String(
      item.npsConversationStage ||
      ''
    );

  const status =
    String(
      item.status ||
      ''
    );

  if (
    stage === 'finished' ||
    status === 'responded'
  ) {
    continue;
  }

  item.status =
    'duplicate_same_day_blocked';

  item.npsResponseStatus =
    'duplicate_same_day_blocked';

  item.npsConversationStage =
    'finished';

  item.duplicateBlockedAt =
    new Date().toISOString();

  item.duplicateBlockReason =
    'Mesmo telefone, mesma clínica e mesma data já possuem item mais recente na fila.';

  item.duplicateKey =
    key;

  duplicates += 1;
}

if (
  duplicates > 0
) {
  const backupFile =
    `${queueFile}.bak-before-dedupe-${Date.now()}`;

  fs.copyFileSync(
    queueFile,
    backupFile
  );

  fs.writeFileSync(
    queueFile,
    JSON.stringify(
      queue,
      null,
      2
    )
  );

  console.log({
    status:
      'DUPLICATES_BLOCKED',

    duplicates,

    backupFile
  });

} else {

  console.log({
    status:
      'NO_DUPLICATES_FOUND',

    duplicates:
      0
  });
}
