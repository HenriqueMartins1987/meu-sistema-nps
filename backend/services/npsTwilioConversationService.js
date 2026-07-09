const {
  normalizeBrazilPhoneDigits
} = require('./npsDemoModeService');

const NPS_CONVERSATION_STATES = Object.freeze({
  AWAITING_NPS_SCORE: 'AWAITING_NPS_SCORE',
  PROMOTER_INVITATION: 'PROMOTER_INVITATION',
  AWAITING_REFERRAL_DECISION: 'AWAITING_REFERRAL_DECISION',
  AWAITING_REFERRAL_CONTACT: 'AWAITING_REFERRAL_CONTACT',
  AWAITING_MORE_REFERRALS: 'AWAITING_MORE_REFERRALS',
  NEUTRAL_FEEDBACK: 'NEUTRAL_FEEDBACK',
  DETRACTOR_REPORT: 'DETRACTOR_REPORT',
  AUDIO_TRANSCRIPTION_CONFIRMATION: 'AUDIO_TRANSCRIPTION_CONFIRMATION',
  COMPLETED: 'COMPLETED',
  MANUAL_REVIEW: 'MANUAL_REVIEW'
});

const NPS_PROFILES = Object.freeze({
  PROMOTER: 'promotor',
  NEUTRAL: 'neutro',
  DETRACTOR: 'detrator'
});

const AUDIO_TRANSCRIPTION_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  TRANSCRIBED: 'TRANSCRIBED',
  CONFIRMED: 'CONFIRMED',
  CORRECTION_REQUESTED: 'CORRECTION_REQUESTED',
  FAILED: 'FAILED',
  MANUAL_REVIEW: 'MANUAL_REVIEW'
});

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const numberWords = new Map([
  ['zero', 0],
  ['um', 1],
  ['uma', 1],
  ['dois', 2],
  ['duas', 2],
  ['tres', 3],
  ['quatro', 4],
  ['cinco', 5],
  ['seis', 6],
  ['sete', 7],
  ['oito', 8],
  ['nove', 9],
  ['dez', 10]
]);

function extractNpsScore(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const standalone = raw.match(/(?:^|\D)(10|[0-9])(?:\D|$)/);
  if (standalone) {
    const numeric = Number(standalone[1]);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 10 ? numeric : null;
  }

  const normalized = normalizeComparableText(raw);
  for (const [word, score] of numberWords.entries()) {
    const expression = new RegExp(`(^|\\s)${word}(\\s|$)`);
    if (expression.test(normalized)) return score;
  }

  return null;
}

function classifyNpsScore(score) {
  const numericScore = Number(score);
  if (!Number.isInteger(numericScore) || numericScore < 0 || numericScore > 10) {
    return null;
  }
  if (numericScore >= 9) return NPS_PROFILES.PROMOTER;
  if (numericScore >= 7) return NPS_PROFILES.NEUTRAL;
  return NPS_PROFILES.DETRACTOR;
}

function calculateNpsMetricsFromScores(scores = []) {
  const validScores = (Array.isArray(scores) ? scores : [])
    .map((item) => (typeof item === 'object' && item !== null ? item.score : item))
    .filter((score) => score !== null && score !== undefined && score !== '')
    .map(Number)
    .filter((score) => Number.isInteger(score) && score >= 0 && score <= 10);
  const total = validScores.length;
  const promoters = validScores.filter((score) => score >= 9).length;
  const neutrals = validScores.filter((score) => score >= 7 && score <= 8).length;
  const detractors = validScores.filter((score) => score <= 6).length;
  const percentage = (value) => (total ? Math.round((value * 1000) / total) / 10 : 0);

  return {
    total,
    promoters,
    neutrals,
    detractors,
    promoterPercent: percentage(promoters),
    neutralPercent: percentage(neutrals),
    detractorPercent: percentage(detractors),
    nps: total ? Math.round(((promoters / total) * 100) - ((detractors / total) * 100)) : 0
  };
}

function parseDecision(text, positiveTerms = [], negativeTerms = []) {
  const normalized = normalizeComparableText(text);
  if (!normalized) return null;

  if (['1', 'sim', 's', 'yes', 'quero', 'quero indicar alguem', 'indicar outra pessoa', 'indicar'].includes(normalized)) {
    return true;
  }
  if (['2', 'nao', 'n', 'no', 'agora nao', 'finalizar', 'fim', 'encerrar'].includes(normalized)) {
    return false;
  }

  if (positiveTerms.some((term) => normalized.includes(normalizeComparableText(term)))) return true;
  if (negativeTerms.some((term) => normalized.includes(normalizeComparableText(term)))) return false;
  return null;
}

function parseReferralText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return {
      valid: false,
      referralName: null,
      referralPhone: null,
      error: 'empty_referral'
    };
  }

  const phoneMatch = raw.match(/(?:\+?55)?[\s().-]*(?:\d[\s().-]*){10,13}/);
  const referralPhone = phoneMatch ? normalizeBrazilPhoneDigits(phoneMatch[0]) : '';
  const name = raw
    .replace(phoneMatch?.[0] || '', ' ')
    .replace(/(?:nome|telefone|fone|celular|whatsapp|zap)\s*[:=-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!referralPhone) {
    return {
      valid: false,
      referralName: name || null,
      referralPhone: null,
      error: 'invalid_phone'
    };
  }

  return {
    valid: true,
    referralName: name || 'Indicado via NPS',
    referralPhone: `+${referralPhone}`,
    referralPhoneDigits: referralPhone,
    error: null
  };
}

function buildInitialNpsMessage(patientName = 'Mariana Oliveira') {
  return [
    `Olá, ${patientName || 'Mariana Oliveira'}! 😊`,
    '',
    'Esperamos que esteja bem.',
    '',
    'Aqui é a equipe de Experiência do Paciente do Grupo Sorria. Para nós, cuidar bem vai além do atendimento clínico: queremos compreender como foi a sua experiência conosco.',
    '',
    'Por isso, gostaríamos de ouvir você. 💙',
    '',
    'Em uma escala de 0 a 10, qual nota você daria para a sua experiência com a nossa clínica?',
    '',
    '⭐ 0 significa uma experiência muito abaixo do esperado.',
    '⭐ 10 significa uma experiência excelente.',
    '',
    'Sua opinião é muito importante e nos ajuda a melhorar continuamente.',
    '',
    'Você pode responder apenas com um número de 0 a 10. 😊'
  ].join('\n');
}

const NPS_MESSAGES = Object.freeze({
  invalidScore: [
    'Obrigado por responder. 😊',
    '',
    'Para conseguirmos registrar corretamente a sua avaliação, poderia nos informar uma nota de 0 a 10?',
    '',
    'Você pode responder somente com o número.'
  ].join('\n'),
  promoterInvitation: [
    'Que alegria receber sua avaliação! 💙😊',
    '',
    'Ficamos muito felizes em saber que sua experiência com o Grupo Sorria foi positiva.',
    '',
    'A confiança dos nossos pacientes é o maior reconhecimento que podemos receber. 🦷✨',
    '',
    'Gostaríamos de fazer um convite: existe algum familiar, amigo ou conhecido que você gostaria de indicar para conhecer uma de nossas clínicas?',
    '',
    'Responda:',
    '1️⃣ Quero indicar alguém',
    '2️⃣ Agora não'
  ].join('\n'),
  referralRequest: [
    'Muito obrigado pela confiança! 💙',
    '',
    'Você pode nos enviar o contato da pessoa que deseja indicar.',
    '',
    '📱 Você pode:',
    '',
    '• compartilhar o contato diretamente pelo WhatsApp; ou',
    '• digitar o nome e o telefone da pessoa.',
    '',
    'Exemplo:',
    '',
    'Maria Silva',
    '(62) 99999-9999',
    '',
    'Assim que recebermos os dados, nossa equipe dará continuidade ao atendimento com todo cuidado e atenção. 😊'
  ].join('\n'),
  referralSaved: [
    'Indicação recebida com sucesso! 💙✨',
    '',
    'Muito obrigado por confiar no Grupo Sorria e por nos permitir cuidar de pessoas importantes para você.',
    '',
    'Nossa equipe dará continuidade ao contato com toda atenção e cuidado. 😊',
    '',
    'Você gostaria de indicar mais alguém?',
    '',
    '1️⃣ Indicar outra pessoa',
    '2️⃣ Finalizar'
  ].join('\n'),
  promoterDeclined: [
    'Sem problema! 😊💙',
    '',
    'Agradecemos muito pela sua avaliação e, principalmente, pela confiança em nosso trabalho.',
    '',
    'Sua opinião é fundamental para continuarmos oferecendo uma experiência cada vez melhor aos nossos pacientes.',
    '',
    'Conte sempre com o Grupo Sorria. 🦷✨'
  ].join('\n'),
  neutralQuestion: [
    'Muito obrigado por compartilhar sua avaliação conosco. 💙',
    '',
    'Sua opinião é essencial para entendermos onde estamos acertando e, principalmente, onde podemos evoluir.',
    '',
    'Gostaríamos de compreender um pouco melhor a sua experiência:',
    '',
    '💬 Na sua percepção, o que faltou ou o que poderíamos ter feito de forma diferente para que sua experiência conosco fosse considerada ótima ou excelente?',
    '',
    'Sinta-se à vontade para responder por texto ou enviar um áudio. 🎙️',
    '',
    'Queremos ouvir você com atenção.'
  ].join('\n'),
  neutralThanks: [
    'Muito obrigado por nos contar sua percepção. 💙',
    '',
    'Seu relato foi registrado e será considerado em nossas análises de melhoria da experiência do paciente.',
    '',
    'Avaliações como a sua nos ajudam a identificar oportunidades reais de evolução.',
    '',
    'Agradecemos pela confiança no Grupo Sorria. 😊🦷'
  ].join('\n'),
  detractorQuestion: [
    'Lamentamos saber que sua experiência não correspondeu às suas expectativas. 😔',
    '',
    'Sua manifestação é muito importante para nós, e queremos compreender com atenção o que aconteceu.',
    '',
    'Por favor, conte-nos o ocorrido e, se possível, informe quais pontos da sua experiência causaram insatisfação.',
    '',
    'Você pode escrever sua mensagem ou enviar um áudio. 🎙️',
    '',
    'Fique à vontade para relatar os fatos da forma que considerar mais adequada. Seu relato será registrado para análise e tratamento responsável pela nossa equipe.'
  ].join('\n'),
  detractorThanks: [
    'Agradecemos por dedicar seu tempo para nos contar o ocorrido.',
    '',
    'Seu relato foi registrado com atenção e será encaminhado para o fluxo responsável de análise e tratamento.',
    '',
    'As informações compartilhadas por você são fundamentais para que possamos identificar oportunidades de correção e melhoria.',
    '',
    'Agradecemos pela transparência e pela oportunidade de compreender melhor a sua experiência. 💙'
  ].join('\n'),
  transcriptionCorrectionRequest: [
    'Obrigado por nos avisar. 😊',
    '',
    'Por favor, envie a correção por texto ou, se preferir, encaminhe um novo áudio.'
  ].join('\n')
});

function buildAudioTranscriptionConfirmationMessage(transcript = '') {
  return [
    '🎙️ Recebemos sua mensagem de áudio e realizamos uma transcrição automática para facilitar o registro e a análise do seu relato.',
    '',
    '📝 Transcrição:',
    '',
    `“${String(transcript || '').trim()}”`,
    '',
    'Por favor, confirme se o texto acima representa corretamente o que você nos informou no áudio.',
    '',
    '1️⃣ Sim, está correto',
    '2️⃣ Preciso corrigir'
  ].join('\n');
}

function getNextStateAfterScore(score) {
  const profile = classifyNpsScore(score);
  if (profile === NPS_PROFILES.PROMOTER) return NPS_CONVERSATION_STATES.AWAITING_REFERRAL_DECISION;
  if (profile === NPS_PROFILES.NEUTRAL) return NPS_CONVERSATION_STATES.NEUTRAL_FEEDBACK;
  if (profile === NPS_PROFILES.DETRACTOR) return NPS_CONVERSATION_STATES.DETRACTOR_REPORT;
  return NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE;
}

function buildScoreReply(score) {
  const profile = classifyNpsScore(score);
  if (profile === NPS_PROFILES.PROMOTER) return NPS_MESSAGES.promoterInvitation;
  if (profile === NPS_PROFILES.NEUTRAL) return NPS_MESSAGES.neutralQuestion;
  if (profile === NPS_PROFILES.DETRACTOR) return NPS_MESSAGES.detractorQuestion;
  return NPS_MESSAGES.invalidScore;
}

function isAudioPayload(payload = {}) {
  const mimeType = String(payload.mimeType || payload.MediaContentType0 || payload.media_mime_type || '').toLowerCase();
  const mediaUrl = payload.mediaUrl || payload.MediaUrl0 || payload.media_url || null;
  return Boolean(mediaUrl) && mimeType.startsWith('audio/');
}

function advanceConversationState(currentState, inbound = {}) {
  const state = currentState || NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE;
  const text = inbound.text || inbound.Body || inbound.message || '';
  const audio = Boolean(inbound.isAudio) || isAudioPayload(inbound);

  if (audio && [
    NPS_CONVERSATION_STATES.NEUTRAL_FEEDBACK,
    NPS_CONVERSATION_STATES.DETRACTOR_REPORT
  ].includes(state)) {
    return {
      action: 'transcribe_audio',
      nextState: NPS_CONVERSATION_STATES.AUDIO_TRANSCRIPTION_CONFIRMATION
    };
  }

  if (state === NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE) {
    const score = extractNpsScore(text);
    if (score === null) {
      return {
        action: 'invalid_score',
        reply: NPS_MESSAGES.invalidScore,
        nextState: state
      };
    }

    return {
      action: 'score_received',
      score,
      profile: classifyNpsScore(score),
      reply: buildScoreReply(score),
      nextState: getNextStateAfterScore(score)
    };
  }

  if (state === NPS_CONVERSATION_STATES.AWAITING_REFERRAL_DECISION) {
    const decision = parseDecision(text, ['quero indicar', 'indicar alguem'], ['agora nao', 'nao quero']);
    if (decision === true) {
      return {
        action: 'referral_accepted',
        reply: NPS_MESSAGES.referralRequest,
        nextState: NPS_CONVERSATION_STATES.AWAITING_REFERRAL_CONTACT
      };
    }
    if (decision === false) {
      return {
        action: 'referral_declined',
        reply: NPS_MESSAGES.promoterDeclined,
        nextState: NPS_CONVERSATION_STATES.COMPLETED
      };
    }
    return {
      action: 'referral_decision_invalid',
      reply: NPS_MESSAGES.promoterInvitation,
      nextState: state
    };
  }

  if (state === NPS_CONVERSATION_STATES.AWAITING_REFERRAL_CONTACT) {
    const referral = parseReferralText(text);
    if (!referral.valid) {
      return {
        action: 'referral_invalid',
        referral,
        reply: NPS_MESSAGES.referralRequest,
        nextState: state
      };
    }
    return {
      action: 'referral_received',
      referral,
      reply: NPS_MESSAGES.referralSaved,
      nextState: NPS_CONVERSATION_STATES.AWAITING_MORE_REFERRALS
    };
  }

  if (state === NPS_CONVERSATION_STATES.AWAITING_MORE_REFERRALS) {
    const decision = parseDecision(text, ['indicar outra pessoa', 'mais alguem'], ['finalizar', 'encerrar']);
    if (decision === true) {
      return {
        action: 'more_referrals',
        reply: NPS_MESSAGES.referralRequest,
        nextState: NPS_CONVERSATION_STATES.AWAITING_REFERRAL_CONTACT
      };
    }
    if (decision === false) {
      return {
        action: 'conversation_completed',
        reply: NPS_MESSAGES.promoterDeclined,
        nextState: NPS_CONVERSATION_STATES.COMPLETED
      };
    }
    return {
      action: 'more_referrals_invalid',
      reply: NPS_MESSAGES.referralSaved,
      nextState: state
    };
  }

  if (state === NPS_CONVERSATION_STATES.NEUTRAL_FEEDBACK) {
    return {
      action: 'neutral_feedback_received',
      feedback: String(text || '').trim(),
      reply: NPS_MESSAGES.neutralThanks,
      nextState: NPS_CONVERSATION_STATES.COMPLETED
    };
  }

  if (state === NPS_CONVERSATION_STATES.DETRACTOR_REPORT) {
    return {
      action: 'detractor_feedback_received',
      feedback: String(text || '').trim(),
      reply: NPS_MESSAGES.detractorThanks,
      nextState: NPS_CONVERSATION_STATES.COMPLETED
    };
  }

  if (state === NPS_CONVERSATION_STATES.AUDIO_TRANSCRIPTION_CONFIRMATION) {
    const decision = parseDecision(text, ['sim esta correto', 'correto'], ['preciso corrigir', 'corrigir']);
    if (decision === true) {
      return {
        action: 'transcription_confirmed',
        nextState: NPS_CONVERSATION_STATES.COMPLETED
      };
    }
    if (decision === false) {
      return {
        action: 'transcription_correction_requested',
        reply: NPS_MESSAGES.transcriptionCorrectionRequest,
        nextState: NPS_CONVERSATION_STATES.MANUAL_REVIEW
      };
    }
    return {
      action: 'transcription_confirmation_invalid',
      nextState: state
    };
  }

  return {
    action: 'completed_or_manual_review',
    nextState: state
  };
}

module.exports = {
  AUDIO_TRANSCRIPTION_STATUSES,
  NPS_CONVERSATION_STATES,
  NPS_MESSAGES,
  NPS_PROFILES,
  advanceConversationState,
  buildAudioTranscriptionConfirmationMessage,
  buildInitialNpsMessage,
  buildScoreReply,
  calculateNpsMetricsFromScores,
  classifyNpsScore,
  extractNpsScore,
  getNextStateAfterScore,
  isAudioPayload,
  normalizeComparableText,
  parseDecision,
  parseReferralText
};
