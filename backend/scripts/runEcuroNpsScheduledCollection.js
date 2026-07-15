require('dotenv').config({
  quiet: true
});

const fs =
  require('fs');

const path =
  require('path');

const {
  spawnSync
} =
  require('child_process');

const APP_DIR =
  '/root/meu-sistema-nps/backend';

process.chdir(
  APP_DIR
);

function nowSaoPaulo() {
  return new Date(
    new Date().toLocaleString(
      'en-US',
      {
        timeZone:
          'America/Sao_Paulo'
      }
    )
  );
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateStamp(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-');
}

function log(title, payload) {
  console.log('');
  console.log(`=== ${title} ===`);

  if (
    payload !== undefined
  ) {
    if (
      typeof payload === 'string'
    ) {
      console.log(payload);
    } else {
      console.log(
        JSON.stringify(
          payload,
          null,
          2
        )
      );
    }
  }
}

function runNodeScript(scriptPath, env = {}) {
  if (
    !fs.existsSync(
      scriptPath
    )
  ) {
    console.log({
      status:
        'SCRIPT_NOT_FOUND',

      scriptPath
    });

    return;
  }

  const result =
    spawnSync(
      'node',
      [
        scriptPath
      ],
      {
        cwd:
          APP_DIR,

        env: {
          ...process.env,
          ...env
        },

        encoding:
          'utf8'
      }
    );

  if (
    result.stdout
  ) {
    console.log(
      result.stdout
    );
  }

  if (
    result.stderr
  ) {
    console.error(
      result.stderr
    );
  }

  if (
    result.status !== 0
  ) {
    throw new Error(
      `Script falhou: ${scriptPath}`
    );
  }
}

async function main() {
  const start =
    nowSaoPaulo();

  const dayOfWeek =
    start.getDay();
    // 0 domingo, 1 segunda, ..., 6 sábado

  const hour =
    start.getHours();

  const forceRun =
    String(
      process.env.FORCE_RUN ||
      'false'
    ).toLowerCase() === 'true';

  const dateMode =
    String(
      process.env.ECURO_NPS_DATE_MODE ||
      'tomorrow'
    ).trim();

  log(
    'INICIO_COLETA_NPS',
    {
      startedAt:
        start.toISOString(),

      saoPauloDate:
        dateStamp(start),

      dayOfWeek,

      hour,

      forceRun,

      dateMode
    }
  );

  if (
    !forceRun
  ) {
    const isMondayToSaturday =
      dayOfWeek >= 1 &&
      dayOfWeek <= 6;

    const isAllowedHour =
      hour >= 6 &&
      hour <= 18;

    if (
      !isMondayToSaturday
    ) {
      log(
        'FORA_DIA_PERMITIDO',
        'Coleta bloqueada. Permitido apenas de segunda a sábado.'
      );

      return;
    }

    if (
      !isAllowedHour
    ) {
      log(
        'FORA_JANELA_HORARIA',
        'Coleta bloqueada. Permitido apenas das 06:00 às 18:59.'
      );

      return;
    }
  } else {
    log(
      'EXECUCAO_FORCADA_MANUAL',
      'Modo usado apenas para teste. O cron continuará respeitando a regra oficial.'
    );
  }

  const apiKey =
    process.env.ECURO_ROBOT_API_KEY;

  if (
    !apiKey
  ) {
    throw new Error(
      'ECURO_ROBOT_API_KEY ausente.'
    );
  }

  const robotBaseUrl =
    process.env.ECURO_ROBOT_SERVICE_URL ||
    `http://${process.env.ECURO_ROBOT_HOST || '127.0.0.1'}:${process.env.ECURO_ROBOT_PORT || process.env.ROBOT_PORT || 3010}`;

  log(
    'ROBOT_CONFIG',
    {
      robotBaseUrl,
      hasApiKey:
        Boolean(apiKey)
    }
  );

  log(
    '1_VALIDANDO_HEALTH_ROBO'
  );

  const health =
    await fetch(
      `${robotBaseUrl}/health`,
      {
        headers: {
          'x-api-key':
            apiKey
        }
      }
    );

  const healthText =
    await health.text();

  console.log({
    status:
      health.status,

    body:
      healthText
  });

  if (
    !health.ok
  ) {
    throw new Error(
      `HEALTH_ROBO_FALHOU_HTTP_${health.status}`
    );
  }

  log(
    '2_EXECUTANDO_COLETA_SEQUENCIAL_CLINICAS'
  );

  const robotDryRun =
    String(
      process.env.ECURO_ROBOT_DRY_RUN ||
      'true'
    ).toLowerCase() === 'true';

  const payload = {
    source:
      'ecuro_excel_scheduled_nps',

    jobType:
      'ecuro_daily_nps_collection_job',

    dateMode,

    dryRun:
      robotDryRun,

    dispatchEnabled:
      String(
        process.env.NPS_DISPATCH_ENABLED ||
        'false'
      ).toLowerCase() === 'true',

    dispatchIntervalSeconds:
      Number(
        process.env.NPS_DISPATCH_INTERVAL_SECONDS ||
        60
      )
  };

  log(
    'DISPATCH_CONFIG',
    {
      robotDryRun,
      npsDispatchEnabled:
        process.env.NPS_DISPATCH_ENABLED,
      npsDispatchIntervalSeconds:
        process.env.NPS_DISPATCH_INTERVAL_SECONDS,
      npsWindowStart:
        process.env.NPS_DISPATCH_WINDOW_START,
      npsWindowEnd:
        process.env.NPS_DISPATCH_WINDOW_END
    }
  );

  const collection =
    await fetch(
      `${robotBaseUrl}/ecuro/excel/run-sequential-clinics`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          'x-api-key':
            apiKey
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );

  const collectionText =
    await collection.text();

  console.log({
    status:
      collection.status,

    body:
      collectionText
  });

  if (
    !collection.ok
  ) {
    throw new Error(
      `COLETA_ROBO_FALHOU_HTTP_${collection.status}`
    );
  }

  log(
    '3_NORMALIZANDO_CLINICAS_NA_FILA'
  );

  runNodeScript(
    path.join(
      APP_DIR,
      'scripts',
      'normalizeNpsClinicQueue.js'
    ),
    {
      DRY_RUN:
        'false'
    }
  );

  log(
    '4_BLOQUEANDO_DUPLICIDADES_DO_DIA'
  );

  runNodeScript(
    path.join(
      APP_DIR,
      'scripts',
      'blockNpsQueueDuplicatesSameDay.js'
    )
  );

  if (
    String(
      process.env.NPS_DISPATCH_ENABLED ||
      'false'
    ).toLowerCase() === 'true'
  ) {
    log(
      '5_DISPARANDO_NPS_PENDING'
    );

    runNodeScript(
      path.join(
        APP_DIR,
        'scripts',
        'dispatchPendingNpsQueue.js'
      )
    );
  } else {
    log(
      '5_DISPATCH_DESABILITADO',
      {
        NPS_DISPATCH_ENABLED:
          process.env.NPS_DISPATCH_ENABLED || null
      }
    );
  }


  log(
    '5_SYNC_RESPOSTAS_NPS_BANCO'
  );

  runNodeScript(
    path.join(
      APP_DIR,
      'scripts',
      'syncNpsQueueResponsesToDatabase.js'
    )
  );


  log(
    '5_RESUMO_DA_FILA'
  );

  const queueFile =
    path.join(
      APP_DIR,
      'runtime',
      'ecuro-db',
      'ecuro-nps-queue.json'
    );

  if (
    !fs.existsSync(
      queueFile
    )
  ) {
    console.log({
      status:
        'QUEUE_FILE_NOT_FOUND'
    });

    return;
  }

  const stat =
    fs.statSync(
      queueFile
    );

  const queue =
    JSON.parse(
      fs.readFileSync(
        queueFile,
        'utf8'
      )
    );

  const byClinic =
    new Map();

  for (
    const item of queue
  ) {
    const clinicCode =
      String(
        item.clinicCode ||
        'SEM_CODIGO'
      );

    const clinicName =
      String(
        item.clinicName ||
        'SEM_NOME'
      );

    const key =
      `${clinicCode} | ${clinicName}`;

    if (
      !byClinic.has(
        key
      )
    ) {
      byClinic.set(
        key,
        {
          clinicCode,
          clinicName,
          total:
            0,

          withPhone:
            0,

          open:
            0,

          finished:
            0,

          resolved:
            0,

          unresolved:
            0,

          duplicateBlocked:
            0
        }
      );
    }

    const row =
      byClinic.get(
        key
      );

    row.total += 1;

    const phone =
      String(
        item.patientPhone ||
        ''
      ).replace(
        /\D/g,
        ''
      );

    if (
      phone.length >= 12 &&
      phone.length <= 13
    ) {
      row.withPhone += 1;
    }

    if (
      String(
        item.npsConversationStage ||
        ''
      ) === 'finished'
    ) {
      row.finished += 1;
    } else {
      row.open += 1;
    }

    if (
      item.clinicRegistryResolved
    ) {
      row.resolved += 1;
    } else {
      row.unresolved += 1;
    }

    if (
      String(
        item.status ||
        ''
      ) === 'duplicate_same_day_blocked'
    ) {
      row.duplicateBlocked += 1;
    }
  }

  const rows =
    Array
      .from(
        byClinic.values()
      )
      .sort(
        (a, b) =>
          b.withPhone - a.withPhone
      );

  console.log({
    status:
      'QUEUE_SUMMARY',

    modifiedAt:
      stat.mtime.toISOString(),

    totalQueue:
      queue.length,

    totalClinics:
      rows.length
  });

  console.table(
    rows.slice(
      0,
      80
    )
  );

  log(
    'FIM_COLETA_NPS',
    {
      finishedAt:
        nowSaoPaulo().toISOString()
    }
  );
}

main().catch(error => {
  console.error({
    status:
      'ECURO_SCHEDULED_COLLECTION_FAILED',

    message:
      error.message
  });

  process.exit(1);
});
