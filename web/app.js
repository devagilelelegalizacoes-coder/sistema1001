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
document.querySelectorAll(".aba").forEach((btn) => {
  btn.onclick = async () => {
    if (btn.hidden) return;
    document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativo", b === btn));
    document.querySelectorAll(".aba-conteudo").forEach((s) => (s.hidden = true));
    $("aba-" + btn.dataset.aba).hidden = false;
    if (btn.dataset.aba === "avisos") await carregarAvisos();
    if (btn.dataset.aba === "notas") { await carregarFaturaveis(); await carregarNotas(); }
    if (btn.dataset.aba === "relatorios") await carregarRelatorios();
    if (btn.dataset.aba === "usuarios") await carregarUsuarios();
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
  const linhas = processos.filter((p) => !busca || (p.placa || "").includes(busca));
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
  abrirModal("modal-editar-processo");
}

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
      }),
    });
    fecharModal("modal-editar-processo");
    await carregar();
  } catch (e2) {
    erro.textContent = e2.message; erro.hidden = false;
  }
});

async function carregarLotesFormulario() {
  try {
    const lotes = await api("/lotes");
    const sel = $("sel-lote-formulario");
    sel.innerHTML = lotes.length
      ? lotes.map((l) => `<option value="${l.id}">${l.nome} (${l.qtd_processos})</option>`).join("")
      : `<option value="">nenhum lote</option>`;
  } catch { /* quem não é admin/operador ainda vê a lista de processos normalmente */ }
}

$("btn-formulario-lote").onclick = async () => {
  const loteId = $("sel-lote-formulario").value;
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

function abrirEdicaoNota(id) {
  const n = notas.find((x) => x.id === id);
  if (!n) return;
  $("en-id").value = n.id;
  $("en-referencia").textContent = n.referencia;
  $("en-numero-nf").value = n.numero_nf || "";
  $("en-status").value = n.status;
  $("en-emissao").value = n.data_emissao || "";
  $("en-pagamento").value = n.data_pagamento || "";
  $("en-destinatario").value = n.destinatario || "";
  abrirModal("modal-editar-nota");
}

$("form-editar-nota").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("erro-editar-nota");
  erro.hidden = true;
  try {
    await api(`/notas/${$("en-id").value}`, {
      method: "PATCH",
      body: JSON.stringify({
        numero_nf: $("en-numero-nf").value.trim() || null,
        status: $("en-status").value,
        data_emissao: $("en-emissao").value || null,
        data_pagamento: $("en-pagamento").value || null,
        destinatario: $("en-destinatario").value.trim() || null,
      }),
    });
    fecharModal("modal-editar-nota");
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

token ? iniciar() : (($("tela-login").hidden = false));
