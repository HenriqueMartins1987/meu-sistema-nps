const {
  listClinics,
  resolveClinic
} =
  require('../services/npsClinicRegistry');

const clinics =
  listClinics();

const codes =
  new Set();

const errors = [];

for (const clinic of clinics) {
  if (!clinic.code) {
    errors.push(
      `Clínica sem código: ${clinic.displayName}`
    );
  }

  if (!clinic.displayName.startsWith('Sorria ')) {
    errors.push(
      `Display sem prefixo Sorria: ${clinic.code} - ${clinic.displayName}`
    );
  }

  if (codes.has(clinic.code)) {
    errors.push(
      `Código duplicado: ${clinic.code}`
    );
  }

  codes.add(
    clinic.code
  );

  const resolved =
    resolveClinic({
      clinicCode:
        clinic.code
    });

  if (
    !resolved.found
  ) {
    errors.push(
      `Código não resolve: ${clinic.code}`
    );
  }
}

console.table(
  clinics
);

console.log({
  totalClinics:
    clinics.length,

  errors:
    errors.length
});

if (
  errors.length
) {
  console.error(
    errors
  );

  process.exit(1);
}

console.log({
  status:
    'NPS_CLINIC_REGISTRY_VALID'
});
