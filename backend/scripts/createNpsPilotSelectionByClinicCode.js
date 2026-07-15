const fs =
  require('fs');

const path =
  require('path');

const {
  enrichClinicFields,
  normalizeCode,
  resolveClinic
} =
  require('../services/npsClinicRegistry');

function normalizePhone(value) {
  return String(
    value || ''
  ).replace(/\D/g, '');
}

function csvEscape(value) {
  const text =
    String(
      value ?? ''
    );

  return `"${text.replace(/"/g, '""')}"`;
}

const queueFile =
  path.join(
    __dirname,
    '..',
    'runtime',
    'ecuro-db',
    'ecuro-nps-queue.json'
  );

const responsesFile =
  path.join(
    __dirname,
    '..',
    'runtime',
    'ecuro-db',
    'ecuro-nps-responses.json'
  );

const pilotClinicCode =
  normalizeCode(
    process.env.PILOT_CLINIC_CODE
  );

const limit =
  Number(
    process.env.PILOT_LIMIT || 30
  );

const pilotDir =
  process.env.PILOT_DIR;

if (!pilotClinicCode) {
  console.error(
    'ERRO: PILOT_CLINIC_CODE ausente.'
  );

  process.exit(1);
}

if (!pilotDir) {
  console.error(
    'ERRO: PILOT_DIR ausente.'
  );

  process.exit(1);
}

const clinicResolved =
  resolveClinic({
    clinicCode:
      pilotClinicCode
  });

if (
  !clinicResolved.found
) {
  console.error({
    status:
      'PILOT_CLINIC_CODE_NOT_FOUND',

    pilotClinicCode
  });

  process.exit(1);
}

const officialClinic =
  clinicResolved.clinic;

const queue =
  JSON.parse(
    fs.readFileSync(
      queueFile,
      'utf8'
    )
  );

let responses = [];

if (
  fs.existsSync(
    responsesFile
  )
) {
  responses =
    JSON.parse(
      fs.readFileSync(
        responsesFile,
        'utf8'
      )
    );
}

const respondedPhones =
  new Set(
    responses
      .map(item =>
        normalizePhone(
          item.patientPhone ||
          item.whatsappPhone ||
          item.phone
        )
      )
      .filter(Boolean)
  );

const byPhone =
  new Map();

for (const rawItem of queue) {
  const item =
    enrichClinicFields(
      rawItem
    );

  if (
    normalizeCode(
      item.clinicCode
    ) !== pilotClinicCode
  ) {
    continue;
  }

  const source =
    String(
      item.source || ''
    );

  if (
    source.includes(
      'homologacao'
    )
  ) {
    continue;
  }

  const phone =
    normalizePhone(
      item.patientPhone ||
      item.whatsappPhone ||
      item.phone
    );

  if (
    phone.length < 12 ||
    phone.length > 13
  ) {
    continue;
  }

  if (
    respondedPhones.has(
      phone
    )
  ) {
    continue;
  }

  const status =
    String(
      item.status || ''
    );

  const stage =
    String(
      item.npsConversationStage || ''
    );

  if (
    status === 'archived_test' ||
    status === 'failed' ||
    status === 'responded'
  ) {
    continue;
  }

  if (
    stage === 'finished'
  ) {
    continue;
  }

  const previous =
    byPhone.get(
      phone
    );

  const currentTime =
    new Date(
      item.createdAt ||
      item.sentAt ||
      item.updatedAt ||
      0
    ).getTime();

  const previousTime =
    previous
      ? new Date(
          previous.createdAt ||
          previous.sentAt ||
          previous.updatedAt ||
          0
        ).getTime()
      : -1;

  if (
    !previous ||
    currentTime >= previousTime
  ) {
    byPhone.set(
      phone,
      {
        originalId:
          item.id || null,

        patientId:
          item.patientId || null,

        patientName:
          String(
            item.patientName || 'Paciente'
          ).trim(),

        patientPhone:
          phone,

        clinicCode:
          officialClinic.code,

        clinicName:
          officialClinic.displayName,

        clinicBaseName:
          officialClinic.baseName,

        clinicCity:
          officialClinic.city,

        clinicUf:
          officialClinic.uf,

        source:
          source || 'ecuro_last_consultation',

        lastConsultationDate:
          item.lastConsultationDate || null,

        targetDate:
          item.targetDate || null,

        selectedAt:
          new Date().toISOString()
      }
    );
  }
}

const selected =
  Array
    .from(
      byPhone.values()
    )
    .slice(
      0,
      limit
    )
    .map(
      (item, index) => ({
        ...item,

        pilotIndex:
          index + 1
      })
    );

if (!selected.length) {
  console.error({
    status:
      'PILOT_CANDIDATES_EMPTY',

    pilotClinicCode,

    clinicName:
      officialClinic.displayName,

    limit
  });

  process.exit(1);
}

fs.mkdirSync(
  pilotDir,
  {
    recursive:
      true
  }
);

fs.writeFileSync(
  path.join(
    pilotDir,
    'selected-patients.json'
  ),
  JSON.stringify(
    selected,
    null,
    2
  )
);

const csvRows = [
  [
    'pilotIndex',
    'patientName',
    'patientPhone',
    'clinicCode',
    'clinicName',
    'lastConsultationDate',
    'targetDate',
    'originalId'
  ].join(',')
];

for (const item of selected) {
  csvRows.push(
    [
      item.pilotIndex,
      item.patientName,
      item.patientPhone,
      item.clinicCode,
      item.clinicName,
      item.lastConsultationDate,
      item.targetDate,
      item.originalId
    ]
      .map(
        csvEscape
      )
      .join(',')
  );
}

fs.writeFileSync(
  path.join(
    pilotDir,
    'selected-patients.csv'
  ),
  csvRows.join('\n') + '\n'
);

console.table(
  selected.map(item => ({
    index:
      item.pilotIndex,

    patientName:
      item.patientName,

    phone:
      item.patientPhone,

    clinicCode:
      item.clinicCode,

    clinicName:
      item.clinicName
  }))
);

console.log({
  status:
    'PILOT_SELECTED_CREATED_BY_CODE',

  pilotClinicCode,

  clinicName:
    officialClinic.displayName,

  total:
    selected.length,

  pilotDir
});
