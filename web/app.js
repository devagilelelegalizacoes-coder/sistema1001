/* Front mínimo do Sistema 1001. Sem framework: o que ele faz é listar,
   filtrar, cadastrar e mostrar o status — o resto da regra vive na API. */
 
const API = window.API_URL || "/api";
const ROTULO = {
  no_prazo: "No prazo", prazo_proximo: "Prazo próximo", atrasado: "Atrasado",
  exigencia: "Exigência", parado: "Parado", concluido: "Concluído",
};
const TIPOS = [
  ["", "Todos"], ["volante", "Transferência"], ["atpve", "ATPV-e"],
  ["licenciamento", "Licenciamento"], ["avulso", "Avulsos"],
];
// espelha api/app/regras.py ETAPAS — só os rótulos, o cálculo de status é da API
const ETAPAS = {
  volante: ["Recebido", "Documentos conferidos", "Débitos levantados", "Formulário preenchido",
    "Solicitação enviada", "Garagem avisada", "Vistoria confirmada", "Vistoria realizada",
    "Enviado para emissão", "Exigência aberta", "Faltou / reagendar", "Concluído"],
  atpve: ["Recebido", "Agendado no DETRAN", "Documento conferido", "Formulário preenchido",
    "Exigência aberta", "Concluído"],
  licenciamento: ["Recebido", "Débitos conferidos", "Formulário preenchido",
    "Exigência aberta", "Concluído"],
  avulso: ["Recebido", "Em análise", "Em andamento", "Exigência aberta",
    "Faltou / parado", "Concluído"],
};
 
let token = localStorage.getItem("token1001") || "";
let papelAtual = "";
let filtroTipo = "";
let processos = [];
 
const $ = (id) => document.getElementById(id);
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
 
async function api(caminho, opcoes = {}) {
  const r = await fetch(API + caminho, {
    ...opcoes,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(opcoes.headers || {}) },
  });
  if (r.status === 401) { sair(); throw new Error("sessão expirada"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "erro " + r.status);
  if (r.status === 204) return null;
  return r.json();
}
 
function sair() {
  token = ""; localStorage.removeItem("token1001");
  $("tela-app").hidden = true; $("tela-login").hidden = false; $("usuario").innerHTML = "";
}
 
async function entrar() {
  const erro = $("erro-login");
  erro.hidden = true;
  try {
    const r = await fetch(API + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("in-email").value, senha: $("in-senha").value }),
    });
    if (!r.ok) throw new Error("E-mail ou senha incorretos");
    const d = await r.json();
    token = d.access_token;
    localStorage.setItem("token1001", token);
    await iniciar();
  } catch (e) {
    erro.textContent = e.message; erro.hidden = false;
  }
}
 
async function iniciar() {
  let eu;
  try { eu = await api("/auth/eu"); } catch { sair(); return; }
  papelAtual = eu.papel;
  $("tela-login").hidden = true; $("tela-app").hidden = false;
  $("usuario").innerHTML = `${eu.nome} · ${eu.papel} <button id="btn-sair">sair</button>`;
  $("btn-sair").onclick = sair;
  // faturamento é só admin — a API também trava isso, isto é só a tela
  document.querySelectorAll("[data-so-admin]").forEach((el) => (el.hidden = eu.papel !== "admin"));
  renderFiltros();
  await carregar();
  await carregarAvisos();
  await carregarAlertaExigencia();
  await carregarLotesFormulario();
}
 
/* alerta de documentos em exigência — some por conta própria quando não há nenhum */
async function carregarAlertaExigencia() {
  const banner = $("alerta-exigencia-banner");
  try {
    const alertas = await api("/relatorios/alertas");
    if (!alertas.exigencias.length) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = `⚠ <b>${alertas.exigencias.length}</b> processo(s) com exigência aberta: ` +
      alertas.exigencias.map((e) => `<b>${e.placa || "s/placa"}</b>${e.exigencia ? ` (${e.exigencia})` : ""}`).join(", ");
  } catch { banner.hidden = true; }
}
 
/* ---------------- abas ---------------- */
async function carregarAba(nome) {
  if (nome === "processos") {
    await carregar(); await carregarAlertaExigencia(); await carregarLotesFormulario();
  }
  if (nome === "arquivados") await carregarArquivados();
  if (nome === "avisos") await carregarAvisos();
  if (nome === "notas") { await carregarFaturaveis(); await carregarNotas(); }
  if (nome === "relatorios") await carregarRelatorios();
  if (nome === "usuarios") await carregarUsuarios();
}
 
document.querySelectorAll(".aba").forEach((btn) => {
  btn.onclick = async () => {
    if (btn.hidden) return;
    document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativo", b === btn));
    document.querySelectorAll(".aba-conteudo").forEach((s) => (s.hidden = true));
    $("aba-" + btn.dataset.aba).hidden = false;
    await carregarAba(btn.dataset.aba);
  };
});
 
/* ---------------- processos ---------------- */
function renderFiltros() {
  $("filtros").innerHTML = TIPOS.map(
    ([v, t]) => `<button class="chip ${v === filtroTipo ? "ativo" : ""}" data-tipo="${v}">${t}</button>`
  ).join("");
  document.querySelectorAll(".chip").forEach((b) => {
    b.onclick = () => { filtroTipo = b.dataset.tipo; renderFiltros(); carregar(); };
  });
}
 
async function carregar() {
  const [resumo, lista] = await Promise.all([
    api("/processos/resumo"),
    api("/processos" + (filtroTipo ? `?tipo=${filtroTipo}` : "")),
  ]);
  $("stats").innerHTML = Object.entries(resumo)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<div class="stat ${k}"><b>${n}</b><span>${ROTULO[k] || k}</span></div>`)
    .join("") || `<div class="stat"><b>0</b><span>Nenhum processo</span></div>`;
  processos = lista;
  renderTabela();
}
 
function renderTabela() {
  const busca = $("busca").value.trim().toUpperCase();
  const linhas = processos.filter((p) => !busca
    || (p.placa || "").toUpperCase().includes(busca)
    || (p.numero_ordem || "").toUpperCase().includes(busca));
  $("vazio").hidden = linhas.length > 0;
  $("linhas").innerHTML = linhas.map((p) => `
    <tr class="linha-clicavel" data-id="${p.id}">
      <td>${p.placa
            ? `<span class="placa">${p.placa}</span>`
            : `<span class="sem-placa">sem placa</span>`}
          ${p.numero_ordem ? `<div class="muted mono" style="font-size:11.5px">ordem ${p.numero_ordem}</div>` : ""}</td>
      <td><span class="tipo">${p.tipo_servico}</span></td>
      <td class="mono muted" style="font-size:12px">${p.lote || "—"}</td>
      <td>${p.etapa}${p.exigencia ? `<div class="muted" style="font-size:11.5px">${p.exigencia}</div>` : ""}</td>
      <td class="mono muted">${formatarData(p.data_limite)}</td>
      <td><span class="pill ${p.status}"><i></i>${ROTULO[p.status] || p.status}</span></td>
      <td class="num mono ${p.dias_restantes < 0 ? "" : "muted"}">${p.dias_restantes}</td>
    </tr>`).join("");
  document.querySelectorAll("#linhas tr").forEach((tr) => {
    tr.onclick = () => abrirEdicaoProcesso(Number(tr.dataset.id));
  });
}
 
const formatarData = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
 
function abrirEdicaoProcesso(id) {
  const p = processos.find((x) => x.id === id);
  if (!p) return;
  $("ep-id").value = p.id;
  $("ep-placa").textContent = p.placa || "sem placa";
  $("ep-etapa").innerHTML = (ETAPAS[p.tipo_servico] || [p.etapa])
    .map((e) => `<option ${e === p.etapa ? "selected" : ""}>${e}</option>`).join("");
  $("ep-exigencia").value = p.exigencia || "";
  $("ep-reagendamento").value = "";
  $("ep-prazo").value = p.prazo_dias;
  $("ep-responsavel").value = "";
  $("ep-observacoes").value = p.observacoes || "";
  $("ep-numero-ordem").value = p.numero_ordem || "";
  $("ep-renavam").value = p.renavam || "";
  $("ep-empresa-cnpj").value = "";
  $("btn-arquivar-processo").hidden = p.etapa !== "Concluído";
  $("btn-arquivar-processo").dataset.id = p.id;
  abrirModal("modal-editar-processo");
}
 
$("btn-arquivar-processo").onclick = async () => {
  const id = $("btn-arquivar-processo").dataset.id;
  if (!confirm("Arquivar este processo? Ele sai da tela principal e vai pra aba Arquivados.")) return;
  try {
    await api(`/processos/${id}/arquivar`, { method: "POST" });
    fecharModal("modal-editar-processo");
    await carregar();
  } catch (e) { alert(e.message); }
};
 
// o status "exigência" é calculado só pela etapa (regras.py), não pelo texto —
// então preencher a exigência sem trocar a etapa fazia o processo "sumir" dos
// alertas. Aqui a etapa acompanha automaticamente, a não ser que já esteja
// concluído (não voltamos um processo fechado pra trás sem o usuário pedir).
$("ep-exigencia").addEventListener("input", () => {
  const etapa = $("ep-etapa");
  if ($("ep-exigencia").value.trim() && etapa.value !== "Concluído") {
    etapa.value = "Exigência aberta";
  }
});
 
$("form-editar-processo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-editar-processo");
  erro.hidden = true;
  try {
    await api(`/processos/${$("ep-id").value}`, {
      method: "PATCH",
      body: JSON.stringify({
        etapa: $("ep-etapa").value,
        exigencia: $("ep-exigencia").value.trim() || null,
        data_reagendamento: $("ep-reagendamento").value || null,
        prazo_dias: $("ep-prazo").value ? Number($("ep-prazo").value) : null,
        responsavel_id: $("ep-responsavel").value ? Number($("ep-responsavel").value) : null,
        observacoes: $("ep-observacoes").value.trim() || null,
        numero_ordem: $("ep-numero-ordem").value.trim() || null,
        renavam: $("ep-renavam").value.trim() || null,
        empresa_cnpj: $("ep-empresa-cnpj").value.trim() || null,
      }),
    });
    fecharModal("modal-editar-processo");
    await carregar();
  } catch (e2) {
    erro.textContent = e2.message; erro.hidden = false;
  }
});
 
let lotesCarregados = [];
async function carregarLotesFormulario() {
  try {
    lotesCarregados = await api("/lotes");
    const sel = $("sel-lote-acoes");
    sel.innerHTML = lotesCarregados.length
      ? lotesCarregados.map((l) => `<option value="${l.id}">${l.nome} (${l.qtd_processos})</option>`).join("")
      : `<option value="">nenhum lote</option>`;
    renderEtapasDoLoteSelecionado();
  } catch { /* quem não é admin/operador ainda vê a lista de processos normalmente */ }
}
 
function renderEtapasDoLoteSelecionado() {
  const lote = lotesCarregados.find((l) => String(l.id) === $("sel-lote-acoes").value);
  const opcoes = (lote && ETAPAS[lote.tipo_servico]) || [];
  $("sel-lote-etapa").innerHTML = opcoes.length
    ? opcoes.map((e) => `<option>${e}</option>`).join("")
    : `<option value="">—</option>`;
}
$("sel-lote-acoes").addEventListener("change", renderEtapasDoLoteSelecionado);
 
$("btn-etapa-lote").onclick = async () => {
  const loteId = $("sel-lote-acoes").value;
  const etapa = $("sel-lote-etapa").value;
  if (!loteId || !etapa) { alert("Selecione um lote e uma etapa."); return; }
  const lote = lotesCarregados.find((l) => String(l.id) === loteId);
  if (!confirm(`Mudar a etapa de todos os processos do lote "${lote?.nome}" para "${etapa}"?`)) return;
  try {
    const r = await api(`/processos/lote/${loteId}/etapa`, { method: "PATCH", body: JSON.stringify({ etapa }) });
    alert(`${r.atualizados} processo(s) atualizado(s).`);
    await carregar();
    await carregarAlertaExigencia();
  } catch (e) { alert(e.message); }
};
 
$("btn-arquivar-lote").onclick = async () => {
  const loteId = $("sel-lote-acoes").value;
  if (!loteId) { alert("Selecione um lote."); return; }
  const lote = lotesCarregados.find((l) => String(l.id) === loteId);
  if (!confirm(`Arquivar os processos concluídos do lote "${lote?.nome}"? Os que ainda não terminaram ficam de fora.`)) return;
  try {
    const r = await api(`/processos/lote/${loteId}/arquivar`, { method: "POST" });
    alert(`${r.arquivados} processo(s) arquivado(s).` + (r.ignorados ? ` ${r.ignorados} ainda não concluído(s), ficaram de fora.` : ""));
    await carregar();
    await carregarLotesFormulario();
  } catch (e) { alert(e.message); }
};
 
$("btn-formulario-lote").onclick = async () => {
  const loteId = $("sel-lote-acoes").value;
  if (!loteId) { alert("Não há lote selecionado."); return; }
  const r = await fetch(API + `/lotes/${loteId}/formulario.docx`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) { alert((await r.json().catch(() => ({}))).detail || "Não foi possível gerar o formulário."); return; }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `formulario_lote_${loteId}.docx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
 
$("btn-exportar").onclick = async () => {
  const r = await fetch(API + "/processos/exportar.xlsx", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) { alert("Não foi possível exportar."); return; }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "processos_1001.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
 
/* ---------------- arquivados ---------------- */
let processosArquivados = [];
async function carregarArquivados() {
  processosArquivados = await api("/processos?arquivado=true");
  renderTabelaArquivados();
}
 
function renderTabelaArquivados() {
  const busca = $("busca-arquivados").value.trim().toUpperCase();
  const linhas = processosArquivados.filter((p) => !busca
    || (p.placa || "").toUpperCase().includes(busca)
    || (p.numero_ordem || "").toUpperCase().includes(busca));
  $("arquivados-vazio").hidden = linhas.length > 0;
  $("linhas-arquivados").innerHTML = linhas.map((p) => `
    <tr>
      <td>${p.placa ? `<span class="placa">${p.placa}</span>` : `<span class="sem-placa">sem placa</span>`}</td>
      <td><span class="tipo">${p.tipo_servico}</span></td>
      <td class="mono muted" style="font-size:12px">${p.lote || "—"}</td>
      <td class="mono muted">${new Date(p.arquivado_em).toLocaleString("pt-BR")}</td>
      <td><button class="botao-sec botao" data-desarquivar="${p.id}">desarquivar</button></td>
    </tr>`).join("");
  document.querySelectorAll("[data-desarquivar]").forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/processos/${b.dataset.desarquivar}/desarquivar`, { method: "POST" });
        await carregarArquivados();
      } catch (e) { alert(e.message); }
    };
  });
}
$("busca-arquivados").addEventListener("input", renderTabelaArquivados);
 
/* ---------------- avisos ---------------- */
async function carregarAvisos() {
  const somenteNaoLidos = $("chk-nao-lidos").checked;
  const lista = await api("/avisos" + (somenteNaoLidos ? "?apenas_nao_lidos=true" : ""));
  $("avisos-vazio").hidden = lista.length > 0;
  $("lista-avisos").innerHTML = lista.map((a) => `
    <div class="aviso-item ${a.lido ? "lido" : ""}" data-id="${a.id}">
      <div>
        <div>${a.mensagem}</div>
        <div class="meta">${a.tipo} · ${a.criado_por || "—"} · ${new Date(a.criado_em).toLocaleString("pt-BR")}</div>
      </div>
      ${a.lido ? "" : `<button class="botao-sec botao" data-marcar="${a.id}">marcar lido</button>`}
    </div>`).join("");
  document.querySelectorAll("[data-marcar]").forEach((b) => {
    b.onclick = async () => { await api(`/avisos/${b.dataset.marcar}/lido`, { method: "POST" }); await carregarAvisos(); };
  });
}
$("chk-nao-lidos").addEventListener("change", carregarAvisos);
 
/* ---------------- notas (admin) ---------------- */
async function carregarFaturaveis() {
  // a atualização automática redesenha a tabela: guarda o que o usuário já
  // marcou/digitou para restaurar depois (senão os checkboxes "desmarcam sozinhos")
  const estado = {};
  document.querySelectorAll(".chk-fat").forEach((c) => {
    estado[c.value] = {
      marcado: c.checked,
      despesa: document.querySelector(`.in-despesa[data-id="${c.value}"]`)?.value,
      valor: document.querySelector(`.in-valor[data-id="${c.value}"]`)?.value,
    };
  });
  const lista = await api("/notas/faturaveis");
  $("faturaveis-vazio").hidden = lista.length > 0;
  $("wrap-faturaveis").hidden = lista.length === 0;
  $("linhas-faturaveis").innerHTML = lista.map((p) => `
    <tr>
      <td><input type="checkbox" class="chk-fat" value="${p.processo_id}"></td>
      <td class="placa">${p.placa || "—"}</td>
      <td class="mono muted">${p.numero_ordem || "—"}</td>
      <td><span class="tipo">${p.tipo_servico}</span></td>
      <td class="mono muted">${p.lote || "—"}</td>
      <td class="num"><input type="number" step="0.01" min="0" class="in-despesa" data-id="${p.processo_id}" value="0" style="width:90px"></td>
      <td class="num"><input type="number" step="0.01" min="0" class="in-valor" data-id="${p.processo_id}" value="0" style="width:100px"></td>
    </tr>`).join("");
  for (const [id, s] of Object.entries(estado)) {
    const chk = document.querySelector(`.chk-fat[value="${id}"]`);
    if (!chk) continue;   // processo saiu da lista (já foi faturado)
    chk.checked = s.marcado;
    if (s.despesa != null) document.querySelector(`.in-despesa[data-id="${id}"]`).value = s.despesa;
    if (s.valor != null) document.querySelector(`.in-valor[data-id="${id}"]`).value = s.valor;
  }
}
 
$("form-gerar-nota").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-gerar-nota");
  erro.hidden = true;
  const selecionados = [...document.querySelectorAll(".chk-fat:checked")].map((c) => Number(c.value));
  if (!selecionados.length) { erro.textContent = "Selecione ao menos um processo."; erro.hidden = false; return; }
  const itens = selecionados.map((id) => ({
    processo_id: id,
    despesa: Number(document.querySelector(`.in-despesa[data-id="${id}"]`).value || 0),
    valor_nota: Number(document.querySelector(`.in-valor[data-id="${id}"]`).value || 0),
  }));
  try {
    await api("/notas", {
      method: "POST",
      body: JSON.stringify({
        referencia: $("nota-referencia").value.trim(),
        destinatario: $("nota-destinatario").value.trim() || null,
        itens,
      }),
    });
    $("form-gerar-nota").reset();
    await carregarFaturaveis();
    await carregarNotas();
  } catch (e2) {
    erro.textContent = e2.message; erro.hidden = false;
  }
});
 
let notas = [];
async function carregarNotas() {
  notas = await api("/notas");
  $("notas-vazio").hidden = notas.length > 0;
  $("linhas-notas").innerHTML = notas.map((n) => `
    <tr class="linha-clicavel" data-id="${n.id}">
      <td>${n.referencia}</td>
      <td class="mono">${n.numero_nf || "—"}</td>
      <td><span class="tipo">${n.status}</span></td>
      <td class="num mono">${n.quantidade}</td>
      <td class="num mono">${brl(n.despesas)}</td>
      <td class="num mono">${brl(n.valor)}</td>
      <td class="num mono">${brl(n.diferenca)}</td>
      <td class="num mono">${brl(n.imposto)}</td>
      <td class="num mono">${brl(n.lucro_liquido)}</td>
      <td class="muted" style="font-size:12.5px">${n.destinatario || "—"}</td>
      <td></td>
    </tr>`).join("");
  document.querySelectorAll("#linhas-notas tr").forEach((tr) => {
    tr.onclick = () => abrirEdicaoNota(Number(tr.dataset.id));
  });
}
 
// itens em edição no modal da nota: começa com os já lançados na nota,
// depois pode ganhar candidatos (processos concluídos ainda não faturados)
let itensEdicaoNota = [];
let mostrarTodosNaEdicaoNota = false;

async function abrirEdicaoNota(id) {
  const n = notas.find((x) => x.id === id);
  if (!n) return;
  $("en-id").value = n.id;
  $("en-referencia").textContent = n.referencia;
  $("en-numero-nf").value = n.numero_nf || "";
  $("en-status").value = n.status;
  $("en-emissao").value = n.data_emissao || "";
  $("en-pagamento").value = n.data_pagamento || "";
  $("en-destinatario").value = n.destinatario || "";
  itensEdicaoNota = n.itens.map((i) => ({ ...i }));
  mostrarTodosNaEdicaoNota = false;
  abrirModal("modal-editar-nota");
  await renderVeiculosDaNota();
}

async function renderVeiculosDaNota() {
  const notaId = Number($("en-id").value);
  const candidatos = await api(`/notas/faturaveis?excluir_nota_id=${notaId}`);
  const idsNaNota = new Set(itensEdicaoNota.map((i) => i.processo_id));
  let lista = candidatos.filter((c) => !idsNaNota.has(c.processo_id));
  if (!mostrarTodosNaEdicaoNota) {
    // além dos já concluídos (candidatos sempre são "Concluído"), aqui só
    // restringe pra não poluir a tela com todo o backlog de uma vez
    lista = lista.slice(0, 50);
  }
  const linhas = [];
  itensEdicaoNota.forEach((it) => {
    linhas.push({ processo_id: it.processo_id, placa: it.placa, numero_ordem: it.numero_ordem,
      tipo_servico: it.tipo_servico, lote: it.lote, marcado: true,
      despesa: it.despesa, valor_nota: it.valor_nota });
  });
  lista.forEach((c) => {
    linhas.push({ ...c, marcado: false, despesa: 0, valor_nota: 0 });
  });

  $("en-lista-veiculos").innerHTML = linhas.map((l) => `
    <div class="item-nota-linha ${l.marcado ? "marcado" : ""}">
      <div class="item-nota-topo">
        <label class="item-nota-check">
          <input type="checkbox" class="en-chk-item" data-id="${l.processo_id}" ${l.marcado ? "checked" : ""}>
          <span><b>${l.placa || "—"}</b>
            ${l.numero_ordem ? ` <span class="muted mono">ordem ${l.numero_ordem}</span>` : ""}
            <div class="muted" style="font-size:11.5px">${l.tipo_servico}${l.lote ? " · " + l.lote : ""}</div>
          </span>
        </label>
        ${l.marcado ? `<button type="button" class="item-nota-remover" data-remover="${l.processo_id}" title="Tirar da nota">✕</button>` : ""}
      </div>
      ${l.marcado ? `
      <div class="item-nota-valores">
        <label>Despesa<input type="number" step="0.01" min="0" class="en-item-despesa" data-id="${l.processo_id}" value="${l.despesa}"></label>
        <label>Valor da nota<input type="number" step="0.01" min="0" class="en-item-valor" data-id="${l.processo_id}" value="${l.valor_nota}"></label>
      </div>` : ""}
    </div>`).join("") || `<p class="hint">Nenhum veículo disponível.</p>`;

  document.querySelectorAll(".en-chk-item").forEach((chk) => {
    chk.onchange = async () => {
      lerItensDoFormularioNota();
      const id = Number(chk.getAttribute("data-id"));
      if (chk.checked) {
        const c = candidatos.find((x) => x.processo_id === id);
        if (c) itensEdicaoNota.push({ ...c, despesa: 0, valor_nota: 0 });
      } else {
        itensEdicaoNota = itensEdicaoNota.filter((i) => i.processo_id !== id);
      }
      await renderVeiculosDaNota();
    };
  });
  document.querySelectorAll("[data-remover]").forEach((btn) => {
    btn.onclick = async () => {
      lerItensDoFormularioNota();
      const id = Number(btn.getAttribute("data-remover"));
      itensEdicaoNota = itensEdicaoNota.filter((i) => i.processo_id !== id);
      await renderVeiculosDaNota();
    };
  });
  document.querySelectorAll(".en-item-despesa, .en-item-valor").forEach((inp) => {
    inp.onchange = () => lerItensDoFormularioNota();
  });
}

function lerItensDoFormularioNota() {
  itensEdicaoNota.forEach((it) => {
    const d = document.querySelector(`.en-item-despesa[data-id="${it.processo_id}"]`);
    const v = document.querySelector(`.en-item-valor[data-id="${it.processo_id}"]`);
    if (d) it.despesa = Number(d.value || 0);
    if (v) it.valor_nota = Number(v.value || 0);
  });
}

$("en-mostrar-todos").onclick = async () => {
  lerItensDoFormularioNota();
  mostrarTodosNaEdicaoNota = !mostrarTodosNaEdicaoNota;
  $("en-mostrar-todos").textContent = mostrarTodosNaEdicaoNota ? "Só os 50 primeiros" : "Mostrar todos";
  await renderVeiculosDaNota();
};

$("form-editar-nota").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-editar-nota");
  erro.hidden = true;
  lerItensDoFormularioNota();
  if (!itensEdicaoNota.length) {
    erro.textContent = "A nota precisa ter ao menos um veículo."; erro.hidden = false; return;
  }
  try {
    await api(`/notas/${$("en-id").value}`, {
      method: "PATCH",
      body: JSON.stringify({
        numero_nf: $("en-numero-nf").value.trim() || null,
        status: $("en-status").value,
        data_emissao: $("en-emissao").value || null,
        data_pagamento: $("en-pagamento").value || null,
        destinatario: $("en-destinatario").value.trim() || null,
        itens: itensEdicaoNota.map((i) => ({
          processo_id: i.processo_id, despesa: i.despesa, valor_nota: i.valor_nota,
        })),
      }),
    });
    fecharModal("modal-editar-nota");
    await carregarFaturaveis();
    await carregarNotas();
  } catch (e2) {
    erro.textContent = e2.message; erro.hidden = false;
  }
});
 
$("btn-ver-resumo").onclick = async () => {
  try {
    const r = await api(`/notas/${$("en-id").value}/resumo`);
    $("rn-assunto").textContent = r.assunto;
    $("rn-corpo").textContent = r.corpo;
    abrirModal("modal-resumo-nota");
  } catch (e) { alert(e.message); }
};
 
$("btn-enviar-nota").onclick = async () => {
  try {
    const r = await api(`/notas/${$("en-id").value}/enviar`, { method: "POST" });
    alert("Enviado para " + r.enviado_para);
    await carregarNotas();
  } catch (e) { alert(e.message); }
};
 
/* ---------------- relatórios (admin) ---------------- */
async function carregarRelatorios() {
  const mensal = await api("/relatorios/mensal");
 
  // lucro real = soma de todas as notas, não só do mês — é o que sobra pro escritório
  // imposto e lucro líquido já vêm calculados da API (regras.py: 6% sobre o valor)
  const total = mensal.reduce((acc, m) => ({
    notas: acc.notas + m.notas, despesas: acc.despesas + m.despesas,
    valor: acc.valor + m.valor, diferenca: acc.diferenca + m.diferenca,
    imposto: acc.imposto + m.imposto, lucro_liquido: acc.lucro_liquido + m.lucro_liquido,
    recebido: acc.recebido + m.recebido,
  }), { notas: 0, despesas: 0, valor: 0, diferenca: 0, imposto: 0, lucro_liquido: 0, recebido: 0 });
  $("stats-lucro").innerHTML = `
    <div class="stat"><b>${brl(total.valor)}</b><span>Receita (valor das notas)</span></div>
    <div class="stat"><b>${brl(total.despesas)}</b><span>Despesas</span></div>
    <div class="stat"><b>${brl(total.diferenca)}</b><span>Diferença (antes do imposto)</span></div>
    <div class="stat"><b>${brl(total.imposto)}</b><span>Imposto (6% do valor)</span></div>
    <div class="stat ${total.lucro_liquido >= 0 ? "no_prazo" : "atrasado"}"><b>${brl(total.lucro_liquido)}</b><span>Lucro real (líquido)</span></div>
    <div class="stat"><b>${brl(total.recebido)}</b><span>Já recebido (notas pagas)</span></div>`;
 
  $("linhas-mensal").innerHTML = mensal.map((m) => `
    <tr>
      <td class="mono">${m.mes}</td>
      <td class="num mono">${m.notas}</td>
      <td class="num mono">${brl(m.despesas)}</td>
      <td class="num mono">${brl(m.valor)}</td>
      <td class="num mono">${brl(m.diferenca)}</td>
      <td class="num mono">${brl(m.imposto)}</td>
      <td class="num mono">${brl(m.lucro_liquido)}</td>
      <td class="num mono">${brl(m.recebido)}</td>
    </tr>`).join("");
 
  const alertas = await api("/relatorios/alertas");
  $("alerta-atrasados").innerHTML = alertas.atrasados
    .map((a) => `<li>${a.placa || "—"} · ${a.tipo_servico} · ${formatarData(a.data_limite)} (${a.dias}d)</li>`).join("");
  $("alerta-proximos").innerHTML = alertas.prazo_proximo
    .map((a) => `<li>${a.placa || "—"} · ${a.tipo_servico} · ${formatarData(a.data_limite)} (${a.dias}d)</li>`).join("");
  $("alerta-exigencias").innerHTML = alertas.exigencias
    .map((a) => `<li>${a.placa || "—"} · ${a.exigencia || a.tipo_servico}</li>`).join("");
  $("alerta-encaixes").innerHTML = alertas.encaixe_fechando
    .map((e) => `<li>${e.lote} · vistoria ${formatarData(e.data_vistoria)} · fecha ${formatarData(e.fecha_em)}</li>`).join("");
}
 
/* ---------------- usuários (admin) ---------------- */
const PAPEL_ROTULO = { admin: "Administrador", operador: "Operador", despachante: "Despachante", cliente: "Cliente" };
 
async function carregarUsuarios() {
  const lista = await api("/usuarios");
  $("linhas-usuarios").innerHTML = lista.map((u) => `
    <tr>
      <td>${u.nome}</td>
      <td class="mono muted" style="font-size:12.5px">${u.email}</td>
      <td><span class="tipo">${PAPEL_ROTULO[u.papel] || u.papel}</span></td>
      <td class="mono muted">${u.empresa_id ?? "—"}</td>
      <td class="mono muted">${u.matricula || "—"}</td>
      <td>${u.ativo ? "sim" : "não"}</td>
      <td><button class="botao-sec botao" data-toggle-ativo="${u.id}" data-ativo="${u.ativo}">
        ${u.ativo ? "desativar" : "reativar"}</button></td>
    </tr>`).join("");
  document.querySelectorAll("[data-toggle-ativo]").forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/usuarios/${b.dataset.toggleAtivo}`, {
          method: "PATCH",
          body: JSON.stringify({ ativo: b.dataset.ativo !== "true" }),
        });
        await carregarUsuarios();
      } catch (e) { alert(e.message); }
    };
  });
}
 
$("btn-novo-usuario").onclick = () => { $("form-usuario").reset(); abrirModal("modal-usuario"); };
 
$("form-usuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-usuario");
  erro.hidden = true;
  try {
    await api("/usuarios", {
      method: "POST",
      body: JSON.stringify({
        nome: $("u-nome").value.trim(),
        email: $("u-email").value.trim(),
        senha: $("u-senha").value,
        papel: $("u-papel").value,
        empresa_id: $("u-empresa-id").value ? Number($("u-empresa-id").value) : null,
        matricula: $("u-matricula").value.trim() || null,
      }),
    });
    fecharModal("modal-usuario");
    await carregarUsuarios();
  } catch (e2) {
    erro.textContent = e2.message; erro.hidden = false;
  }
});
 
/* ---------------- modais genéricos ---------------- */
function abrirModal(id) {
  document.querySelectorAll(`#${id} .erro`).forEach((e) => (e.hidden = true));
  $(id).hidden = false;
}
function fecharModal(id) { $(id).hidden = true; }
 
document.querySelectorAll(".modal-fundo").forEach((fundo) => {
  fundo.addEventListener("click", (e) => { if (e.target === fundo) fundo.hidden = true; });
  fundo.querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = () => (fundo.hidden = true)));
});
 
$("btn-novo-processo").onclick = () => {
  $("form-processo").reset();
  $("p-data-recebimento").valueAsDate = new Date();
  abrirModal("modal-processo");
};
$("btn-novo-aviso").onclick = () => { $("form-aviso").reset(); abrirModal("modal-aviso"); };
 
$("form-processo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-processo");
  erro.hidden = true;
  try {
    await api("/processos", {
      method: "POST",
      body: JSON.stringify({
        placa: $("p-placa").value.trim().toUpperCase(),
        numero_ordem: $("p-numero-ordem").value.trim() || null,
        renavam: $("p-renavam").value.trim() || null,
        tipo_servico: $("p-tipo").value,
        data_recebimento: $("p-data-recebimento").value,
        prazo_dias: $("p-prazo").value ? Number($("p-prazo").value) : null,
        lote_nome: $("p-lote").value.trim() || null,
        empresa_cnpj: $("p-empresa-cnpj").value.trim() || null,
        observacoes: $("p-observacoes").value.trim() || null,
      }),
    });
    fecharModal("modal-processo");
    await carregar();
    await carregarLotesFormulario();
  } catch (e2) {
    erro.textContent = e2.message; erro.hidden = false;
  }
});
 
$("form-aviso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-aviso");
  erro.hidden = true;
  try {
    await api("/avisos", {
      method: "POST",
      body: JSON.stringify({
        mensagem: $("a-mensagem").value.trim(),
        tipo: $("a-tipo").value,
        processo_id: $("a-processo-id").value ? Number($("a-processo-id").value) : null,
      }),
    });
    fecharModal("modal-aviso");
    await carregarAvisos();
  } catch (e2) {
    erro.textContent = e2.message; erro.hidden = false;
  }
});
 
$("btn-entrar").onclick = entrar;
$("in-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
$("busca").addEventListener("input", renderTabela);
 
/* ---------------- atualização automática ---------------- */
// sem isto, um cadastro feito por outra pessoa só aparecia depois de F5.
// Atualiza só a aba visível, e pula enquanto algum formulário está aberto
// (senão apagaria o que a pessoa está digitando, ex.: valores da nota).
const INTERVALO_ATUALIZACAO_MS = 20000;
 
function podeAtualizarAgora() {
  if (!token || $("tela-app").hidden) return false;
  if (document.hidden) return false;
  if (document.querySelector(".modal-fundo:not([hidden])")) return false;
  // não redesenha enquanto a pessoa está digitando num campo (perderia o foco)
  const foco = document.activeElement;
  if (foco && foco !== $("busca") && foco.type !== "checkbox"
      && ["INPUT", "TEXTAREA", "SELECT"].includes(foco.tagName)) return false;
  return true;
}
 
async function atualizarAbaAtiva() {
  if (!podeAtualizarAgora()) return;
  const abaAtiva = document.querySelector(".aba.ativo");
  if (abaAtiva) await carregarAba(abaAtiva.dataset.aba);
}
 
setInterval(atualizarAbaAtiva, INTERVALO_ATUALIZACAO_MS);
document.addEventListener("visibilitychange", atualizarAbaAtiva);
window.addEventListener("focus", atualizarAbaAtiva);
 
token ? iniciar() : (($("tela-login").hidden = false));
 