'use strict';

// Interrupção administrativa centralizada dos envios de e-mail do sistema NPS.
// O preload deste arquivo força o serviço de e-mail a operar somente em modo de log,
// preservando os fluxos internos sem entregar mensagens a destinatários externos.
process.env.EMAIL_PROVIDER = 'log';
process.env.EMAIL_SENDING_SUSPENDED = 'true';

console.warn('[NPS] Envios de e-mail suspensos por decisão administrativa. Mensagens serão apenas registradas em log.');
