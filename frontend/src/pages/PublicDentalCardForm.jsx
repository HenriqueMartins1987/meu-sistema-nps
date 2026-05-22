import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import api from '../api';
import './PublicDentalCardForm.css';

const initialForm = {
  quemIndicou: '',
  vinculoIndicador: '',
  nomeIndicado: '',
  telefone: '',
  unidade: '',
  email: '',
  responsavelCadastro: '',
  observacoes: '',
  website: ''
};

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatPhone(value) {
  const digits = onlyDigits(value).replace(/^55/, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
}

function normalizePhone(value) {
  const digits = onlyDigits(value);
  return digits.startsWith('55') ? digits.slice(0, 13) : `55${digits}`.slice(0, 13);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif' || file.type.includes('heic') || file.type.includes('heif')) return file;

  const dataUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });

  const maxSide = 1600;
  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}

export default function PublicDentalCardForm() {
  const { unidadeSlug } = useParams();
  const [form, setForm] = useState(initialForm);
  const [clinics, setClinics] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    api.get(`/public/dental-card/config${unidadeSlug ? `/${unidadeSlug}` : ''}`)
      .then((response) => {
        if (!mounted) return;
        const list = Array.isArray(response.data?.clinics) ? response.data.clinics : [];
        setClinics(list);
        const matched = unidadeSlug ? list.find((clinic) => clinic.slug === unidadeSlug) : null;
        if (matched) setForm((current) => ({ ...current, unidade: matched.name }));
      })
      .catch(() => setError('Não foi possível carregar as unidades. Atualize a página e tente novamente.'));
    return () => { mounted = false; };
  }, [unidadeSlug]);

  const progress = useMemo(() => {
    const required = [form.quemIndicou, form.vinculoIndicador, form.nomeIndicado, form.telefone, form.unidade, photo];
    const done = required.filter(Boolean).length;
    return Math.round((done / required.length) * 100);
  }, [form, photo]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handlePhoto(event) {
    const selected = event.target.files?.[0] || null;
    setError('');
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setError('Envie apenas imagem.');
      return;
    }
    if (selected.size > 8 * 1024 * 1024) {
      setError('A imagem precisa ter até 8 MB.');
      return;
    }
    const compressed = await compressImage(selected);
    setPhoto(compressed);
    setPreview(URL.createObjectURL(compressed));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const phone = normalizePhone(form.telefone);
      if (!/^55\d{10,11}$/.test(phone)) {
        throw new Error('Informe telefone/WhatsApp com DDD.');
      }
      if (!photo) {
        throw new Error('Envie a foto com quem indicou.');
      }

      const payload = new FormData();
      payload.append('quemIndicou', form.quemIndicou);
      payload.append('vinculoIndicador', form.vinculoIndicador);
      payload.append('nomeIndicado', form.nomeIndicado);
      payload.append('telefone', phone);
      payload.append('unidade', form.unidade);
      payload.append('email', form.email);
      payload.append('responsavelCadastro', form.responsavelCadastro);
      payload.append('observacoes', form.observacoes);
      payload.append('website', form.website);
      payload.append('linkOrigem', window.location.href);
      payload.append('unidadeSlug', unidadeSlug || '');
      payload.append('foto', photo);

      const response = await api.post(`/public/dental-card${unidadeSlug ? `/${unidadeSlug}` : ''}`, payload, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSuccess(response.data || { message: 'Indicação recebida com sucesso.' });
      setForm(initialForm);
      setPhoto(null);
      setPreview('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Não foi possível enviar a indicação.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main className="public-dental-page">
        <section className="public-dental-success">
          <p className="public-dental-eyebrow">Dental Card</p>
          <h1>Indicação recebida com sucesso.</h1>
          <p>Nossa equipe entrará em contato para dar continuidade ao atendimento.</p>
          <strong>{success.protocol || ''}</strong>
          <button type="button" onClick={() => setSuccess(null)}>Enviar nova indicação</button>
        </section>
      </main>
    );
  }

  return (
    <main className="public-dental-page">
      <form className="public-dental-form" onSubmit={submit}>
        <header className="public-dental-header">
          <p className="public-dental-eyebrow">Programa Dental Card</p>
          <h1>Indicação de Pacientes</h1>
          <p>Preencha os dados abaixo para que a equipe do Grupo Sorria faça o retorno em até 24 horas.</p>
          <div className="public-progress" aria-label={`Progresso ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </header>

        {error ? <div className="public-dental-alert">{error}</div> : null}

        <input
          className="public-dental-honeypot"
          tabIndex="-1"
          autoComplete="off"
          value={form.website}
          onChange={(event) => update('website', event.target.value)}
          name="website"
        />

        <section className="public-dental-section">
          <h2>Quem está indicando</h2>
          <label>Quem indicou? <input value={form.quemIndicou} onChange={(event) => update('quemIndicou', event.target.value)} required /></label>
          <label>Vínculo/Grau de parentesco <input value={form.vinculoIndicador} onChange={(event) => update('vinculoIndicador', event.target.value)} required /></label>
          <label>Endereço de e-mail <input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="opcional" /></label>
          <label>Responsável por esse cadastro <input value={form.responsavelCadastro} onChange={(event) => update('responsavelCadastro', event.target.value)} placeholder="opcional" /></label>
        </section>

        <section className="public-dental-section">
          <h2>Dados do indicado</h2>
          <label>Nome do indicado <input value={form.nomeIndicado} onChange={(event) => update('nomeIndicado', event.target.value)} required /></label>
          <label>Telefone / WhatsApp <input inputMode="tel" value={formatPhone(form.telefone)} onChange={(event) => update('telefone', event.target.value)} required /></label>
          <label>Unidade
            <select value={form.unidade} onChange={(event) => update('unidade', event.target.value)} required>
              <option value="">Selecione a unidade</option>
              {clinics.map((clinic) => <option key={clinic.id || clinic.name} value={clinic.name}>{clinic.name}{clinic.city ? ` - ${clinic.city}` : ''}</option>)}
            </select>
          </label>
          <label>Observações <textarea value={form.observacoes} onChange={(event) => update('observacoes', event.target.value)} placeholder="opcional" /></label>
        </section>

        <section className="public-dental-section public-photo-section">
          <h2>Foto com quem indicou</h2>
          <p>A foto é obrigatória para validar a indicação.</p>
          {preview ? (
            <div className="public-photo-preview">
              <img src={preview} alt="Prévia da foto enviada" />
              <button type="button" onClick={() => { setPhoto(null); setPreview(''); }}>Remover foto</button>
            </div>
          ) : (
            <label className="public-photo-input">
              Tirar foto ou escolher da galeria
              <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} required />
            </label>
          )}
        </section>

        <button className="public-submit" type="submit" disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar Indicação'}
        </button>
      </form>
    </main>
  );
}
