const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

const businessVocabularyPrompt = [
  'Transcreva em portugues brasileiro com fidelidade ao que foi falado.',
  'Nao resuma, nao suavize criticas, nao corrija fatos e nao invente informacoes.',
  'Contexto de vocabulario: Grupo Sorria, NPS, Dental Card, CRC, ortodontia, implante, protese, avaliacao, dentista, clinica, tratamento odontologico, agendamento, recepcao, unidade, paciente, retorno, financeiro, cancelamento, estorno, acordo, tratamento, consulta.'
].join(' ');

function getAudioTranscriptionConfig(env = process.env) {
  return {
    enabled: String(env.AUDIO_TRANSCRIPTION_ENABLED || 'true').trim().toLowerCase() !== 'false',
    model: String(env.AUDIO_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL).trim() || DEFAULT_TRANSCRIPTION_MODEL,
    apiKey: String(env.OPENAI_API_KEY || '').trim(),
    timeoutMs: Math.max(1000, Number(env.AUDIO_TRANSCRIPTION_TIMEOUT_MS || 60000))
  };
}

async function transcribeAudioBuffer(buffer, options = {}) {
  const config = {
    ...getAudioTranscriptionConfig(options.env || process.env),
    ...(options.config || {})
  };

  if (!config.enabled) {
    return {
      success: false,
      status: 'FAILED',
      error: 'Transcricao de audio desabilitada por configuracao.'
    };
  }

  if (!config.apiKey) {
    return {
      success: false,
      status: 'FAILED',
      error: 'OPENAI_API_KEY ausente.'
    };
  }

  const audioBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!audioBuffer.length) {
    return {
      success: false,
      status: 'FAILED',
      error: 'Audio vazio ou indisponivel.'
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      success: false,
      status: 'FAILED',
      error: 'fetch indisponivel no runtime para transcricao.'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const form = new FormData();
    const mimeType = options.mimeType || 'audio/ogg';
    const fileName = options.fileName || 'audio.ogg';
    form.append('model', config.model);
    form.append('prompt', options.prompt || businessVocabularyPrompt);
    form.append('file', new Blob([audioBuffer], { type: mimeType }), fileName);

    const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      body: form,
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        status: 'FAILED',
        error: payload?.error?.message || `Transcricao retornou HTTP ${response.status}.`,
        rawStatus: response.status
      };
    }

    const transcript = String(payload?.text || '').trim();
    if (!transcript) {
      return {
        success: false,
        status: 'FAILED',
        error: 'Transcricao retornou texto vazio.',
        rawStatus: response.status
      };
    }

    return {
      success: true,
      status: 'TRANSCRIBED',
      model: config.model,
      transcript,
      rawStatus: response.status
    };
  } catch (error) {
    return {
      success: false,
      status: 'FAILED',
      error: error?.name === 'AbortError'
        ? 'Timeout ao transcrever audio.'
        : error?.message || 'Falha desconhecida ao transcrever audio.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  DEFAULT_TRANSCRIPTION_MODEL,
  businessVocabularyPrompt,
  getAudioTranscriptionConfig,
  transcribeAudioBuffer
};
