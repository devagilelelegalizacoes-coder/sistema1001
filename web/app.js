/* Front mínimo do Sistema 1001. Sem framework: o que ele faz é listar,
   filtrar e mostrar o status — o resto da regra vive na API. */

const API = window.API_URL || "/api";
const ROTULO = {
  no_prazo: "No prazo", prazo_proximo: "Prazo próximo", atrasado: "Atrasado",
  exigencia: "Exigência", parado: "Parado", concluido: "Concluído",
};
const TIPOS = [
  ["", "Todos"], ["volante", "Transferência"], ["atpve", "ATPV-e"],
  ["licenciamento", "Licenciamento"], ["avulso", "Avulsos"],
];

let token = localStorage.getItem("token1001") || "";
let filtroTipo = "";
let processos = [];

const $ = (id) => document.getElementById(id);

async function api(caminho, opcoes = {}) {
  const r = await fetch(API + caminho, {
    ...opcoes,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(opcoes.headers || {}) },
  });
  if (r.status === 401) { sair(); throw new Error("sessão expirada"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "erro " + r.status);
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
  $("tela-login").hidden = true; $("tela-app").hidden = false;
  $("usuario").innerHTML = `${eu.nome} · ${eu.papel} <button id="btn-sair">sair</button>`;
  $("btn-sair").onclick = sair;
  renderFiltros();
  await carregar();
}

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
    <tr>
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
}

const formatarData = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

$("btn-entrar").onclick = entrar;
$("in-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
$("busca").addEventListener("input", renderTabela);

token ? iniciar() : (($("tela-login").hidden = false));
