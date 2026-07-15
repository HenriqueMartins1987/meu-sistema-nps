const fs =
  require('fs');

const path =
  require('path');

const registryPath =
  path.join(
    __dirname,
    '..',
    'config',
    'nps-clinic-registry.json'
  );

function normalizeCode(value) {
  return String(
    value || ''
  )
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function normalizeText(value) {
  return String(
    value || ''
  )
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function loadRegistry() {
  const raw =
    fs.readFileSync(
      registryPath,
      'utf8'
    );

  const registry =
    JSON.parse(raw);

  if (
    !Array.isArray(
      registry.clinics
    )
  ) {
    throw new Error(
      'nps-clinic-registry.json inválido: clinics ausente.'
    );
  }

  return registry;
}

function buildIndexes() {
  const registry =
    loadRegistry();

  const byCode =
    new Map();

  const byText =
    new Map();

  for (const clinic of registry.clinics) {
    const code =
      normalizeCode(
        clinic.code
      );

    if (!code) {
      continue;
    }

    if (
      byCode.has(code)
    ) {
      throw new Error(
        `Código de clínica duplicado: ${code}`
      );
    }

    byCode.set(
      code,
      clinic
    );

    const aliases = [
      clinic.code,
      clinic.baseName,
      clinic.displayName,
      `${clinic.baseName} · ${clinic.city} / ${clinic.uf}`,
      `${clinic.baseName} - ${clinic.city} / ${clinic.uf}`,
      `${clinic.city} / ${clinic.uf}`
    ];

    for (const alias of aliases) {
      const key =
        normalizeText(alias);

      if (
        key &&
        !byText.has(key)
      ) {
        byText.set(
          key,
          clinic
        );
      }
    }
  }

  return {
    registry,
    byCode,
    byText
  };
}

let cached = null;

function getIndexes() {
  if (!cached) {
    cached =
      buildIndexes();
  }

  return cached;
}

function resolveClinic(input = {}) {
  const indexes =
    getIndexes();

  const codeCandidates = [
    input.clinicCode,
    input.clinic_code,
    input.code,
    input.codigoClinica,
    input.codigo_clinica,
    input.unitCode,
    input.unidadeCodigo
  ];

  for (const candidate of codeCandidates) {
    const code =
      normalizeCode(candidate);

    if (
      code &&
      indexes.byCode.has(code)
    ) {
      const clinic =
        indexes.byCode.get(code);

      return {
        found:
          true,

        resolvedBy:
          'code',

        clinic
      };
    }
  }

  const textCandidates = [
    input.clinicName,
    input.clinic_name,
    input.unitName,
    input.unidade,
    input.fullLabel,
    input.full_label,
    input.name
  ];

  for (const candidate of textCandidates) {
    const text =
      normalizeText(candidate);

    if (
      text &&
      indexes.byText.has(text)
    ) {
      const clinic =
        indexes.byText.get(text);

      return {
        found:
          true,

        resolvedBy:
          'text_exact',

        clinic
      };
    }
  }

  for (const candidate of textCandidates) {
    const text =
      normalizeText(candidate);

    if (!text) {
      continue;
    }

    for (const clinic of indexes.registry.clinics) {
      const base =
        normalizeText(
          clinic.baseName
        );

      const display =
        normalizeText(
          clinic.displayName
        );

      if (
        text.includes(base) ||
        display.includes(text)
      ) {
        return {
          found:
            true,

          resolvedBy:
            'text_partial',

          clinic
        };
      }
    }
  }

  return {
    found:
      false,

    resolvedBy:
      null,

    clinic:
      null
  };
}

function enrichClinicFields(item = {}) {
  const resolved =
    resolveClinic(item);

  if (
    !resolved.found
  ) {
    return {
      ...item,

      clinicRegistryResolved:
        false,

      clinicRegistryResolvedBy:
        null,

      clinicRegistryWarning:
        'CLINIC_NOT_FOUND_IN_REGISTRY'
    };
  }

  const clinic =
    resolved.clinic;

  return {
    ...item,

    clinicCode:
      clinic.code,

    clinicName:
      clinic.displayName,

    clinicDisplayName:
      clinic.displayName,

    clinicBaseName:
      clinic.baseName,

    clinicCity:
      clinic.city,

    clinicUf:
      clinic.uf,

    clinicRegistryResolved:
      true,

    clinicRegistryResolvedBy:
      resolved.resolvedBy,

    clinicRegistryVersion:
      getIndexes().registry.version
  };
}

function listClinics() {
  return getIndexes()
    .registry
    .clinics
    .map(clinic => ({
      code:
        clinic.code,

      displayName:
        clinic.displayName,

      baseName:
        clinic.baseName,

      city:
        clinic.city,

      uf:
        clinic.uf
    }));
}

module.exports = {
  normalizeCode,
  normalizeText,
  loadRegistry,
  resolveClinic,
  enrichClinicFields,
  listClinics
};
