import { useEffect, useState } from 'react';
import axios from 'axios';

function ComplaintsList() {
  const [data, setData] = useState([]);

  const [filters, setFilters] = useState({
    status: '',
    channel: '',
    clinic_id: ''
  });

  const carregar = async () => {
    const params = new URLSearchParams(filters).toString();
    const res = await axios.get(`http://localhost:3001/complaints?${params}`);
    setData(res.data);
  };

  useEffect(() => {
    carregar();
  }, []);

  const handleFilter = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const corStatus = (status) => {
    if (status === 'aberta') return 'red';
    if (status === 'em_andamento') return 'orange';
    if (status === 'resolvida') return 'green';
    return 'gray';
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>CRM de Reclamações</h2>

      {/* FILTROS */}
      <div style={{ marginBottom: 20 }}>
        <select name="status" onChange={handleFilter}>
          <option value="">Status</option>
          <option value="aberta">Aberta</option>
          <option value="em_andamento">Em andamento</option>
          <option value="resolvida">Resolvida</option>
        </select>

        <select name="channel" onChange={handleFilter}>
          <option value="">Canal</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="google">Google</option>
        </select>

        <input
          name="clinic_id"
          placeholder="Clínica"
          onChange={handleFilter}
        />

        <button onClick={carregar}>Filtrar</button>
      </div>

      {/* TABELA */}
      <table border="1" width="100%">
        <thead>
          <tr>
            <th>Paciente</th>
            <th>Telefone</th>
            <th>Canal</th>
            <th>Status</th>
            <th>Descrição</th>
          </tr>
        </thead>

        <tbody>
          {data.map((item) => (
            <tr key={item.id}>
              <td>{item.patient_name}</td>
              <td>{item.patient_phone}</td>
              <td>{item.channel}</td>
              <td style={{ color: corStatus(item.status) }}>
                {item.status}
              </td>
              <td>{item.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ComplaintsList;