import React, { useEffect, useMemo, useRef, useState } from 'react';
import api, { getApiErrorMessage } from '../api';
import { ActionButtons, Card, DashboardGrid, KPICard, PageHeader, SectionContainer } from '../components/DesignSystem';

const agendaColumns = [
  { key: 'todo', label: 'A fazer', helper: 'Ideias, pendencias e proximas acoes' },
  { key: 'today', label: 'Hoje', helper: 'Prioridade do dia' },
  { key: 'doing', label: 'Em andamento', helper: 'Itens em execucao' },
  { key: 'done', label: 'Concluido', helper: 'Finalizados' }
];

const priorityOptions = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' }
];

const emptyDraft = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'normal',
  due_at: '',
  reminder_at: '',
  tags: ''
};

function toDatetimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function isOverdue(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function normalizeDraftFromItem(item = {}) {
  return {
    title: item.title || '',
    description: item.description || '',
    status: item.status || 'todo',
    priority: item.priority || 'normal',
    due_at: toDatetimeLocal(item.due_at),
    reminder_at: toDatetimeLocal(item.reminder_at),
    tags: Array.isArray(item.tags) ? item.tags.join(', ') : ''
  };
}

function AgendaCard({ item, onOpen, onStatus, onDragStart }) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return (
    <article
      className={`agenda-task-card priority-${item.priority || 'normal'} ${isOverdue(item.due_at) && item.status !== 'done' ? 'overdue' : ''}`}
      draggable
      onDragStart={() => onDragStart(item.id)}
    >
      <button type="button" className="agenda-task-main" onClick={() => onOpen(item)}>
        <span className="agenda-priority">{item.priority || 'normal'}</span>
        <strong>{item.title}</strong>
        {item.description ? <p>{item.description}</p> : null}
      </button>
      <div className="agenda-task-meta">
        <span>{formatDateTime(item.due_at)}</span>
        {item.reminder_at ? <span>Lembrete {formatDateTime(item.reminder_at)}</span> : null}
      </div>
      {tags.length ? (
        <div className="agenda-tag-row">
          {tags.map((tag) => <small key={tag}>{tag}</small>)}
        </div>
      ) : null}
      <div className="agenda-card-actions">
        {item.status !== 'doing' && item.status !== 'done' ? (
          <button type="button" onClick={() => onStatus(item, 'doing')}>Iniciar</button>
        ) : null}
        {item.status !== 'done' ? (
          <button type="button" onClick={() => onStatus(item, 'done')}>Concluir</button>
        ) : (
          <button type="button" onClick={() => onStatus(item, 'todo')}>Reabrir</button>
        )}
      </div>
    </article>
  );
}

export default function AgendaPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [reminderItem, setReminderItem] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const notifiedReminderIds = useRef(new Set());
  const titleInputRef = useRef(null);

  const loadItems = async () => {
    setLoading(true);
    setFeedback('');
    try {
      const response = await api.get('/api/agenda/items', {
        params: {
          search: search.trim() || undefined,
          status: activeStatus || undefined
        }
      });
      setItems(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel carregar a agenda.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  useEffect(() => {
    const timer = window.setTimeout(loadItems, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const evaluateReminders = () => {
      const dueReminder = items
        .filter((item) => item.status !== 'done' && item.reminder_at && !item.reminder_acknowledged_at)
        .filter((item) => new Date(item.reminder_at).getTime() <= Date.now())
        .sort((a, b) => new Date(a.reminder_at) - new Date(b.reminder_at))[0];

      if (!dueReminder) return;
      setReminderItem(dueReminder);

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && !notifiedReminderIds.current.has(dueReminder.id)) {
        new Notification('Lembrete da Agenda', {
          body: dueReminder.title,
          tag: `agenda-${dueReminder.id}`
        });
        notifiedReminderIds.current.add(dueReminder.id);
      }
    };

    evaluateReminders();
    const timer = window.setInterval(evaluateReminders, 60000);
    return () => window.clearInterval(timer);
  }, [items]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [editorOpen]);

  const filteredItems = useMemo(() => items, [items]);
  const stats = useMemo(() => {
    const open = filteredItems.filter((item) => item.status !== 'done').length;
    const overdue = filteredItems.filter((item) => item.status !== 'done' && isOverdue(item.due_at)).length;
    const reminders = filteredItems.filter((item) => item.status !== 'done' && item.reminder_at && !item.reminder_acknowledged_at).length;
    const done = filteredItems.filter((item) => item.status === 'done').length;
    return { total: filteredItems.length, open, overdue, reminders, done };
  }, [filteredItems]);

  const groupedItems = useMemo(() => (
    agendaColumns.reduce((acc, column) => {
      acc[column.key] = filteredItems.filter((item) => item.status === column.key);
      return acc;
    }, {})
  ), [filteredItems]);

  const openCreate = (status = 'todo') => {
    setSelectedItem(null);
    setDraft({ ...emptyDraft, status });
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setSelectedItem(item);
    setDraft(normalizeDraftFromItem(item));
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setSelectedItem(null);
    setDraft(emptyDraft);
  };

  const saveItem = async () => {
    if (!draft.title.trim()) {
      setFeedback('Informe um titulo para o item da agenda.');
      return;
    }

    setSaving(true);
    setFeedback('');

    const payload = {
      title: draft.title,
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      due_at: draft.due_at || null,
      reminder_at: draft.reminder_at || null,
      tags: draft.tags
    };

    try {
      if (selectedItem?.id) {
        await api.patch(`/api/agenda/items/${selectedItem.id}`, payload);
      } else {
        await api.post('/api/agenda/items', payload);
      }
      closeEditor();
      await loadItems();
      setFeedback('Agenda atualizada com sucesso.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel salvar o item da agenda.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async () => {
    if (!selectedItem?.id) return;
    const confirmed = window.confirm(`Excluir "${selectedItem.title}" da agenda?`);
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.delete(`/api/agenda/items/${selectedItem.id}`);
      closeEditor();
      await loadItems();
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel excluir o item.'));
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (item, status) => {
    try {
      await api.patch(`/api/agenda/items/${item.id}`, { status });
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status } : row));
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel mover o item.'));
    }
  };

  const handleDrop = async (status) => {
    const item = items.find((row) => row.id === draggingId);
    setDraggingId(null);
    if (!item || item.status === status) return;
    await updateStatus(item, status);
  };

  const acknowledgeReminder = async () => {
    if (!reminderItem?.id) return;
    try {
      await api.patch(`/api/agenda/items/${reminderItem.id}`, { ackReminder: true });
      setReminderItem(null);
      await loadItems();
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel confirmar o lembrete.'));
    }
  };

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      setFeedback('Este navegador nao suporta notificacoes nativas.');
      return;
    }
    const permission = await Notification.requestPermission();
    setFeedback(permission === 'granted' ? 'Notificacoes da Agenda ativadas.' : 'Notificacoes nao foram autorizadas.');
  };

  return (
    <main className="app-page agenda-page">
      <PageHeader
        eyebrow="Workspace"
        title="Agenda"
        description="Quadro executivo para organizar tarefas, compromissos, follow-ups e lembretes operacionais com fluxo visual no estilo ClickUp."
        actions={(
          <>
            <button type="button" className="outline-action" onClick={requestNotifications}>Ativar lembretes</button>
            <button type="button" className="primary-action" onClick={() => openCreate('today')}>Novo item</button>
          </>
        )}
      />

      {reminderItem ? (
        <section className="agenda-reminder-toast">
          <div>
            <span>Lembrete ativo</span>
            <strong>{reminderItem.title}</strong>
            <small>{formatDateTime(reminderItem.reminder_at)}</small>
          </div>
          <ActionButtons>
            <button type="button" className="outline-action" onClick={() => openEdit(reminderItem)}>Abrir</button>
            <button type="button" className="secondary-action" onClick={acknowledgeReminder}>Marcar como visto</button>
          </ActionButtons>
        </section>
      ) : null}

      <DashboardGrid className="agenda-kpis">
        <KPICard label="Total" value={stats.total} helper="itens na agenda" tone="neutral" />
        <KPICard label="Abertos" value={stats.open} helper="em acompanhamento" tone="progress" />
        <KPICard label="Lembretes" value={stats.reminders} helper="ativos ou programados" tone="warning" />
        <KPICard label="Atrasados" value={stats.overdue} helper="fora do prazo" tone="danger" />
        <KPICard label="Concluidos" value={stats.done} helper="finalizados" tone="success" />
      </DashboardGrid>

      <SectionContainer className="agenda-control-panel">
        <div className="agenda-toolbar">
          <div className="agenda-toolbar-copy">
            <strong>Controle operacional</strong>
            <span>Filtre, acompanhe e mova as tarefas entre etapas.</span>
          </div>
          <input
            className="field"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar item, descricao ou tag"
          />
          <select className="field" value={activeStatus} onChange={(event) => setActiveStatus(event.target.value)}>
            <option value="">Todos os status</option>
            {agendaColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
          <button type="button" className="outline-action" onClick={loadItems}>Atualizar</button>
        </div>
      </SectionContainer>

      {feedback && !editorOpen ? <p className="form-feedback">{feedback}</p> : null}

      <section className="agenda-workspace">
        <div className="agenda-board">
          {agendaColumns.map((column) => (
            <section
              key={column.key}
              className="agenda-column"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(column.key)}
            >
              <header>
                <div>
                  <strong>{column.label}</strong>
                  <small>{column.helper}</small>
                </div>
                <span>{groupedItems[column.key]?.length || 0}</span>
              </header>
              <button type="button" className="agenda-add-card" onClick={() => openCreate(column.key)}>+ adicionar</button>
              <div className="agenda-card-list">
                {loading ? <p className="empty-mini">Carregando agenda...</p> : null}
                {!loading && groupedItems[column.key]?.length ? groupedItems[column.key].map((item) => (
                  <AgendaCard
                    key={item.id}
                    item={item}
                    onOpen={openEdit}
                    onStatus={updateStatus}
                    onDragStart={setDraggingId}
                  />
                )) : null}
                {!loading && !groupedItems[column.key]?.length ? <p className="empty-mini">Sem itens nesta etapa.</p> : null}
              </div>
            </section>
          ))}
        </div>

      </section>

      {editorOpen ? (
        <section className="agenda-editor-shell" role="dialog" aria-modal="true" aria-label={selectedItem?.id ? 'Editar item da agenda' : 'Criar item da agenda'}>
          <button type="button" className="agenda-editor-backdrop" aria-label="Fechar agenda" onClick={closeEditor} />
          <aside className="agenda-editor-panel">
            <header className="agenda-editor-hero">
              <div>
                <p className="eyebrow">{selectedItem?.id ? 'Detalhe da tarefa' : 'Novo item'}</p>
                <h2>{selectedItem?.id ? selectedItem.title : 'Criar item na agenda'}</h2>
                <span>Cadastre a tarefa com prazo, prioridade, lembrete e contexto operacional.</span>
              </div>
              <button type="button" className="agenda-editor-close" onClick={closeEditor} aria-label="Fechar">×</button>
            </header>

            {feedback ? <p className="form-feedback agenda-editor-feedback">{feedback}</p> : null}

            <div className="agenda-editor-body">
              <div className="agenda-editor-main">
                <label>
                  Titulo da tarefa
                  <input
                    ref={titleInputRef}
                    className="field agenda-title-field"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ex.: Retornar paciente, revisar protocolo, cobrar evidência"
                  />
                </label>
                <label>
                  Descricao
                  <textarea
                    className="field agenda-textarea"
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Descreva o objetivo, contexto, combinados e qualquer detalhe importante."
                  />
                </label>
                <label>
                  Tags
                  <input
                    className="field"
                    value={draft.tags}
                    onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="Ex.: CRC, urgente, retorno"
                  />
                </label>
              </div>

              <Card className="agenda-editor-side">
                <div className="agenda-editor-side-head">
                  <strong>Propriedades</strong>
                  <span>{selectedItem?.id ? `ID ${selectedItem.id}` : 'Novo'}</span>
                </div>
                <label>
                  Status
                  <select className="field" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                    {agendaColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                  </select>
                </label>
                <label>
                  Prioridade
                  <select className="field" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}>
                    {priorityOptions.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
                  </select>
                </label>
                <label>
                  Prazo
                  <input className="field" type="datetime-local" value={draft.due_at} onChange={(event) => setDraft((current) => ({ ...current, due_at: event.target.value }))} />
                </label>
                <label>
                  Lembrete
                  <input className="field" type="datetime-local" value={draft.reminder_at} onChange={(event) => setDraft((current) => ({ ...current, reminder_at: event.target.value }))} />
                </label>
                <div className="agenda-editor-guide">
                  <strong>Fluxo recomendado</strong>
                  <small>Cadastre, defina prioridade, programe lembrete e mova o card conforme a execução.</small>
                </div>
              </Card>
            </div>

            <footer className="agenda-editor-footer">
              <div>
                {selectedItem?.id ? <button type="button" className="outline-action" onClick={deleteItem} disabled={saving}>Excluir item</button> : null}
              </div>
              <ActionButtons>
                <button type="button" className="secondary-action" onClick={closeEditor} disabled={saving}>Cancelar</button>
                <button type="button" className="primary-action" onClick={saveItem} disabled={saving}>{saving ? 'Salvando...' : 'Salvar na agenda'}</button>
              </ActionButtons>
            </footer>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
