const fs =
  require('fs');

const path =
  require('path');

const {
  enrichClinicFields
} =
  require('../services/npsClinicRegistry');

const queueFile =
  path.join(
    __dirname,
    '..',
    'runtime',
    'ecuro-db',
    'ecuro-nps-queue.json'
  );

const dryRun =
  String(
    process.env.DRY_RUN || 'true'
  ).toLowerCase() !== 'false';

if (
  !fs.existsSync(
    queueFile
  )
) {
  console.error({
    status:
      'QUEUE_FILE_NOT_FOUND',

    queueFile
  });

  process.exit(1);
}

const queue =
  JSON.parse(
    fs.readFileSync(
      queueFile,
      'utf8'
    )
  );

let changed = 0;
let unresolved = 0;

const rows = [];

const normalized =
  queue.map(item => {
    const before = {
      clinicCode:
        item.clinicCode || null,

      clinicName:
        item.clinicName || null
    };

    const enriched =
      enrichClinicFields(item);

    const after = {
      clinicCode:
        enriched.clinicCode || null,

      clinicName:
        enriched.clinicName || null
    };

    const itemChanged =
      JSON.stringify(before) !==
      JSON.stringify(after) ||
      item.clinicRegistryResolved !==
      enriched.clinicRegistryResolved;

    if (
      itemChanged
    ) {
      changed += 1;
    }

    if (
      !enriched.clinicRegistryResolved
    ) {
      unresolved += 1;
    }

    rows.push({
      id:
        item.id || null,

      beforeCode:
        before.clinicCode,

      beforeName:
        before.clinicName,

      afterCode:
        after.clinicCode,

      afterName:
        after.clinicName,

      resolved:
        enriched.clinicRegistryResolved,

      resolvedBy:
        enriched.clinicRegistryResolvedBy || null
    });

    return enriched;
  });

console.table(
  rows.slice(-80)
);

console.log({
  status:
    dryRun
      ? 'DRY_RUN'
      : 'WRITE_MODE',

  total:
    queue.length,

  changed,

  unresolved
});

if (
  !dryRun
) {
  const backupFile =
    `${queueFile}.bak-before-clinic-normalize-${Date.now()}`;

  fs.copyFileSync(
    queueFile,
    backupFile
  );

  fs.writeFileSync(
    queueFile,
    JSON.stringify(
      normalized,
      null,
      2
    )
  );

  console.log({
    status:
      'QUEUE_NORMALIZED',

    backupFile
  });
}
