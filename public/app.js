/* Checa Fato Brasil — Frontend (consome a API /api/*) */

const API = ''; // mesma origem — o backend serve o frontend
let TOKEN = localStorage.getItem('cfb_token') || '';
function authHeaders(){ return TOKEN ? { 'Content-Type':'application/json', 'Authorization':'Bearer '+TOKEN } : { 'Content-Type':'application/json' }; }
async function checkAuth(){ try{ const r=await fetch(API+'/api/auth',{headers:{'Authorization':'Bearer '+TOKEN}}); const d=await r.json(); return d.authed; }catch{ return false; } }

/* ---------- util ---------- */
const $ = (s) => document.querySelector(s);
const seloMap = {
  verdadeiro:{cls:'verdadeiro',txt:'✓ Verdadeiro',ic:'✓'},
  falso:{cls:'falso',txt:'✕ Falso',ic:'✕'},
  enganoso:{cls:'enganoso',txt:'⚠ Enganoso',ic:'⚠'},
  impreciso:{cls:'impreciso',txt:'± Impreciso',ic:'±'},
  inverificavel:{cls:'inverificavel',txt:'? Inverificável',ic:'?'},
  satira:{cls:'satira',txt:'☺ Sátira',ic:'☺'},
  misto:{cls:'misto',txt:'◐ Misto',ic:'◐'}
};
function seloHTML(cls){ const m=seloMap[cls]||seloMap.misto; return '<span class="selo s-'+m.cls+'"><span class="ic">'+m.ic+'</span>'+m.txt+'</span>'; }

/* ---------- navegação ---------- */
function toggleMenu(){ $('#menu').classList.toggle('aberto'); }
function go(v){
  document.querySelectorAll('.vista').forEach(s=>s.classList.add('oculto'));
  const el=$('#v-'+v); if(el) el.classList.remove('oculto');
  document.querySelectorAll('.menu button').forEach(b=>b.classList.toggle('ativo',b.dataset.v===v));
  $('#menu').classList.remove('aberto');
  if(v==='curadoria'){ aplicarCuraUI(); if(TOKEN) loadCura(); }
  if(v==='inicio'){ refreshStats(); renderHistorico(); }
  if(v==='politicos') loadPoliticosReais();
  if(v==='eleitoral') carregarEleitoral();
  if(v==='sobre') carregarIntegridade();
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ---------- verificação ---------- */
const EXAMPLES = [
  "Governo federal aprova aumento de 30% no salário dos vereadores",
  "Eleições no Brasil voltam a usar voto impresso obrigatório",
  "A vacina X não protege e fez mal a milhares de pessoas",
  "Obra municipal superfaturada em 200%, diz auditoria",
  "Senador prometeu construir mil escolas na rede pública"
];
function renderChips(){ $('#chips').innerHTML = EXAMPLES.map((e,i)=>'<div class="chip" onclick="setExample('+i+')">Ex '+ (i+1) +'</div>').join(''); }
function setExample(i){ $('#inp').value=EXAMPLES[i]; $('#url').value=''; }
function limpar(){ $('#inp').value=''; $('#url').value=''; $('#resultado').innerHTML=''; }

async function verificar(){
  const text = $('#inp').value.trim();
  const url = $('#url').value.trim();
  if(!text && !url){ $('#resultado').innerHTML='<div class="note">Informe um trecho ou uma URL para verificar.</div>'; return; }
  const btn = $('#btnVerificar'); btn.innerHTML='<span class="spin"></span>Analisando...'; btn.disabled=true;
  try{
    const r = await fetch(API+'/api/verificar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,url})});
    const d = await r.json();
    renderResultado(d);
    await buscarOficiais(d.category);
  }catch(e){
    $('#resultado').innerHTML='<div class="note">Erro ao contatar o backend. '+(e.message||'')+'</div>';
  }finally{
    btn.innerHTML='✓ Verificar'; btn.disabled=false;
    refreshStats();
  }
}

/* Fontes oficiais de referência em tempo real */
async function buscarOficiais(cat){
  try{
    const r = await fetch(API+'/api/oficiais?q='+encodeURIComponent(cat||'outro'));
    const d = await r.json();
    const wrap = document.getElementById('oficiais');
    if(!wrap) return;
    wrap.innerHTML = '<div class="ev"><h4>Fontes oficiais de referência (consulte para a apuração)</h4>'
      + d.portais.map(p=>'<div style="margin-bottom:8px"><a href="'+p.url+'" target="_blank" rel="noopener">'+p.nome+'</a><div class="fonte">'+p.url+' · '+p.fonte+'</div></div>').join('')
      +'<p class="fonte">🔍 Portais públicos oficiais. Em produção, o motor consulta as APIs abertas desses órgãos em tempo real.</p></div>';
  }catch(e){}
}

/* ---------- histórico local de buscas (localStorage) ---------- */
function addHistorico(rec){
  try{
    const h = JSON.parse(localStorage.getItem('cfb_hist')||'[]');
    h.unshift({ t: rec.title, cls: rec.classification, date: new Date().toISOString() });
    localStorage.setItem('cfb_hist', JSON.stringify(h.slice(0,20)));
    renderHistorico();
  }catch(e){}
}
function renderHistorico(){
  const el = document.getElementById('historico'); if(!el) return;
  let h=[]; try{ h=JSON.parse(localStorage.getItem('cfb_hist')||'[]'); }catch{ h=[]; }
  if(!h.length){ el.innerHTML='<div class="note" style="background:#eef2f6;border-color:#dfe6ec;color:#5a6b7a">Nenhuma verificação sua ainda. Faça uma verificação acima — ela ficará salva aqui.</div>'; return; }
  el.innerHTML = h.map(x=>'<div class="reg" style="cursor:default;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center"><div>'+seloHTML(x.cls)+'</div><div><div class="tt">'+esc(x.t)+'</div><div class="mt">'+fmtData(x.date)+'</div></div><button class="btn seg peq" onclick="removerHistorico('+JSON.stringify(x.t)+')">✕</button></div>').join('');
}
function removerHistorico(t){
  let h=[]; try{ h=JSON.parse(localStorage.getItem('cfb_hist')||'[]'); }catch{}
  h = h.filter(x=>x.t!==t); localStorage.setItem('cfb_hist',JSON.stringify(h)); renderHistorico();
}

/* ---------- pesquisa real (Wikipedia + Câmara) ---------- */
async function pesquisarReal(){
  const q = $('#pesqTermo').value.trim(); const el = $('#pesqResultado');
  if(!q){ el.innerHTML='<div class="note">Digite um tema para pesquisar.</div>'; return; }
  el.innerHTML='<div class="note"><span class="spin"></span>Buscando em fontes reais...</div>';
  try{
    const r=await fetch(API+'/api/pesquisa?q='+encodeURIComponent(q)); const d=await r.json();
    let html='<div class="res">';
    if(d.wikipedia){
      html+='<div class="flexT"><b style="font-size:1.1rem">📖 '+esc(d.wikipedia.titulo)+'</b><a href="'+d.wikipedia.url+'" target="_blank" rel="noopener" class="pill">fonte</a></div>'
        +'<p style="font-size:.93rem;margin-top:8px">'+esc(d.wikipedia.resumo)+'</p>'
        +'<p class="fonte">Fonte: Wikipedia (pt) — '+(d.wikipedia.url?esc(d.wikipedia.url):'')+'</p>';
    } else { html+='<p class="muted">Sem resumo de enciclopédia para este termo.</p>'; }
    if(d.proposicoes && d.proposicoes.length){
      html+='<div class="ev" style="margin-top:12px"><h4>Proposições na Câmara dos Deputados (dados abertos)</h4><ul>'
        + d.proposicoes.map(p=>'<li><a href="'+p.url+'" target="_blank" rel="noopener">'+esc(p.sigla)+'</a> — '+esc(p.ementa)+'</li>').join('')+'</ul></div>';
    }
    if(d.fontes_oficiais && d.fontes_oficiais.length){
      html+='<div class="ev"><h4>Fontes oficiais de referência</h4><ul>'+d.fontes_oficiais.map(f=>'<li><a href="'+f.url+'" target="_blank" rel="noopener">'+esc(f.nome)+'</a></li>').join('')+'</ul></div>';
    }
    html+='<p class="fonte">Consulta real em APIs públicas (Wikipedia pt + dados abertos da Câmara). Evidência para informação, não veredito final.</p></div>';
    el.innerHTML = html;
  }catch(e){ el.innerHTML='<div class="note">Falha na pesquisa real.</div>'; }
}

/* ---------- consulta CNPJ real ---------- */
async function consultarCNPJ(){
  const c=$('#cnpjInp').value.trim(); const el=$('#cnpjResult');
  if(!c){ el.innerHTML='<div class="note">Informe o CNPJ.</div>'; return; }
  el.innerHTML='<div class="note"><span class="spin"></span>Consultando a Receita (BrasilAPI)...</div>';
  try{
    const r=await fetch(API+'/api/cnpj?cnpj='+encodeURIComponent(c)); const d=await r.json();
    if(!d.ok){ el.innerHTML='<div class="note">'+(d.error||'Falha na consulta.')+'</div>'; return; }
    const sit = /ATIVA/i.test(d.situacao);
    el.innerHTML='<div class="res"><div class="flexT"><b style="font-size:1.1rem">🏛 '+esc(d.razaoSocial)+'</b><span class="pill '+(sit?'s-ver':'s-verm')+'">'+esc(d.situacao)+'</span></div>'
      +'<div class="row" style="margin:8px 0"><span class="pill">'+esc(d.municipio)+'/'+esc(d.uf)+'</span><span class="pill">'+esc(d.porte||'-')+'</span><span class="pill">'+esc(d.naturezaJuridica||'-')+'</span></div>'
      +'<div class="ev"><h4>Dados do CNPJ</h4><ul style="font-size:.92rem">'
      +'<li><b>CNPJ:</b> '+esc(d.cnpj)+'</li>'
      +(d.nomeFantasia?'<li><b>Nome fantasia:</b> '+esc(d.nomeFantasia)+'</li>':'')
      +'<li><b>Atividade (CNAE):</b> '+esc(d.cnae||'-')+'</li></ul></div>'
      +'<p class="fonte">Fonte: Receita Federal — BrasilAPI (consulta real).</p></div>';
  }catch(e){ el.innerHTML='<div class="note">Falha na consulta.</div>'; }
}

/* ---------- integridade / revalidação periódica ---------- */
async function carregarIntegridade(){
  const el=$('#integridade'), lista=$('#integridadeLista'); if(!el) return;
  try{
    const r=await fetch(API+'/api/integridade'); const d=await r.json();
    el.innerHTML='<div class="stat"><div class="num">'+d.total+'</div><div class="lab">Registros na base</div></div>'
      +'<div class="stat"><div class="num">'+d.com_consenso_alto+'</div><div class="lab">Com consenso forte</div></div>'
      +'<div class="stat"><div class="num">'+d.a_revisar.length+'</div><div class="lab">Sinalizados para revisão</div></div>';
    lista.innerHTML = d.a_revisar.length ? d.a_revisar.slice(0,10).map(x=>'<div class="reg"><div class="flexT"><div class="row">'+seloHTML(x.classification)+'<span class="tt">'+esc(x.title)+'</span></div><span class="pill s-verm">revisar</span></div><div class="mt">'+esc(x.motivo||'')+'</div></div>').join('') : '<div class="note" style="background:#e7f7ef;border-color:#b6e3cc;color:#0a7d54">✅ Nenhum registro precisa de revisão. Revalidação periódica ativa.</div>';
  }catch(e){ el.innerHTML='<div class="note">Backend indisponível.</div>'; }
}

/* ---------- modo eleitoral ---------- */
async function carregarEleitoral(){
  try{
    const r=await fetch(API+'/api/eleitoral'); const d=await r.json();
    $('#eleitoralStats').innerHTML='<div class="stat"><div class="num">'+d.total_checagens_eleitorais+'</div><div class="lab">Checagens eleitorais na base</div></div>'
      +'<div class="stat"><div class="num">'+d.alertas_falsos_eleitorais.length+'</div><div class="lab">Alertas de conteúdo falso</div></div>'
      +'<div class="stat"><div class="num">TSE</div><div class="lab">Fonte oficial'+(d.fonte_oficial?' · <a href="'+d.fonte_oficial+'" target="_blank">consulte</a>':'')+'</div></div>';
    const al=d.alertas_falsos_eleitorais;
    $('#eleitoralAlertas').innerHTML = al.length? al.map(a=>'<div class="reg"><div class="flexT"><div class="row">'+seloHTML(a.classificacao)+'<span class="tt">'+esc(a.titulo)+'</span></div><span class="pill">'+fmtData(a.verificado_em)+'</span></div></div>').join('') : '<div class="note">Nenhum alerta eleitoral falso no momento.</div>';
  }catch(e){ $('#eleitoralAlertas').innerHTML='<div class="note">Backend indisponível.</div>'; }
}

/* ---------- perfil de político (agregação real) ---------- */
async function loadPoliticosReais(){
  const el=$('#politicosGrid'); if(!el) return;
  try{
    const r=await fetch(API+'/api/politicos'); const d=await r.json();
    if(!d.politicos.length){ el.innerHTML='<div class="note">Nenhum perfil com verificações na base ainda.</div>'; return; }
    const cor=(i)=> i>=70?'var(--verde)': i>=45?'var(--ambar)':'var(--vermelho)';
    el.innerHTML=d.politicos.slice(0,9).map(p=>{
      return '<div class="card"><div class="flexT"><h3>'+esc(p.nome)+'</h3><span class="pill">'+(p.verificacoes)+' verif.</span></div>'
        +'<p class="muted">V:'+p.verdadeiro+' · F:'+p.falso+' · En:'+p.enganoso+' · Im:'+p.impreciso+'</p>'
        +'<div class="barra-conf" style="margin:12px 0"><div style="width:'+p.indice+'%;background:'+cor(p.indice)+'"></div></div>'
        +'<div class="flexT"><b style="font-size:1.3rem;color:'+cor(p.indice)+'">'+p.indice+'%</b><span class="muted" style="font-size:.75rem">índice de veracidade</span></div>'
        +'<div class="ev" style="margin-top:10px"><h4>Últimas</h4><ul style="font-size:.8rem">'+(p.checks||[]).slice(0,3).map(c=>'<li>'+seloHTML(c.classification)+' '+esc(c.title.slice(0,60))+'</li>').join('')+'</ul></div></div>';
    }).join('');
  }catch(e){ el.innerHTML='<div class="note">Backend indisponível.</div>'; }
}

function renderResultado(d){
  const conf = d.confidence||50;
  const cor = conf>=75?'var(--verde)':conf>=50?'var(--ambar)':'var(--vermelho)';
  const metr='<div class="ev"><h4>Análise técnica (métricas)</h4>'
    +'<div class="barra-conf"><div style="width:'+conf+'%;background:'+cor+'"></div></div>'
    +'<div class="flexT"><b>Índice de confiança: '+conf+'%</b><span class="fonte">'+(d.latency_ms!=null?latencia(d.latency_ms):'')+'</span></div>'
    +'<table style="width:100%;font-size:.82rem;margin-top:8px;border-collapse:collapse">'
    +'<tr><td style="padding:3px 0;color:#5a6b7a">Linguagem manipulativa</td><td style="text-align:right">'+(d.lang?d.lang.manipulativeScore+'/100':'n/d')+'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#5a6b7a">Clickbait / sensacionalismo</td><td style="text-align:right">'+(d.lang?d.lang.indicators.sensationalism:'-')+'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#5a6b7a">Domínios oficiais detectados</td><td style="text-align:right">'+(d.lang?d.lang.indicators.oficialDomains:'-')+'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#5a6b7a">Fact-check externo</td><td style="text-align:right">'+(d.factcheck_used?'consultado':'não configurado')+'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#5a6b7a">Correspondência na base local</td><td style="text-align:right">'+(d.local_match?'sim':'não')+'</td></tr>'
    +'</table></div>'
    +'<p class="fonte">🔎 IA não decide sozinha: casos ambíguos seguem para curadoria humana (status: '+d.status+').</p>';
  $('#resultado').innerHTML =
    '<div class="res"><div class="res-top">'+seloHTML(d.classification)+'<h2>'+esc(d.title)+'</h2></div>'
    +'<div class="row" style="margin-bottom:8px"><span class="pill">'+esc(d.category)+'</span>'
    +(d.politician_mentioned?'<span class="pill">'+esc(d.politician_mentioned)+'</span>':'')
    +'<span class="pill">'+esc(d.status)+'</span></div>'
    +'<p style="font-size:1.02rem"><b>Em poucas palavras:</b> '+esc(d.summary)+'</p>'
    +'<div class="ev"><h4>A fundo</h4><p style="font-size:.92rem">'+esc(d.explanation)+'</p></div>'
    +'<div class="ev"><h4>Fontes usadas</h4>'+(d.sources&&d.sources.length?'<ul>'+d.sources.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'<p style="font-size:.9rem">Nenhuma fonte confirmada.</p>')+'</div>'
    +'<div class="credito"><span class="pill">Verificado em '+fmtData(d.verified_at)+'</span><span class="pill">Status: '+esc(d.status)+'</span><span class="pill">ID: '+esc(d.id)+'</span></div>'
    + metr
    +'<div id="oficiais"></div>'
    +(d.consenso?'<div class="ev"><h4>Consenso micro → macro</h4>'+consensoHTML(d.consenso,d.microfontes)+'</div>':'')
    +(d.pesquisa ? '<div class="ev" style="margin-top:12px"><h4>Contexto — fontes reais</h4>'
      +(d.pesquisa.wikipedia ? '<p style="font-size:.9rem">📖 <b>'+esc(d.pesquisa.wikipedia.titulo)+':</b> '+esc(d.pesquisa.wikipedia.resumo.slice(0,420))+'…</p><a class="pill" href="'+d.pesquisa.wikipedia.url+'" target="_blank" rel="noopener">ler na Wikipedia</a>' : '')
      +(d.pesquisa.proposicoes && d.pesquisa.proposicoes.length ? '<div style="margin-top:8px"><b class="muted" style="font-size:.85rem">Proposições na Câmara (dados abertos):</b><ul style="font-size:.85rem;margin-top:4px">'+d.pesquisa.proposicoes.map(p=>'<li><a href="'+p.url+'" target="_blank" rel="noopener">'+esc(p.sigla)+'</a> — '+esc(p.ementa)+'</li>').join('')+'</ul></div>':'')
      +'<p class="fonte">Fontes reais consultadas automaticamente (Wikipedia pt + dados abertos da Câmara).</p></div>':'')
    +'</div>';
  addHistorico(d);
}
function consensoHTML(c, micros){
  const cor = c.grau==='alto'?'var(--verde)': c.grau==='divergente'||c.grau==='sem-consenso'?'var(--vermelho)':'var(--ambar)';
  const rotulo = { alto:'Consenso alto', medio:'Consenso médio', baixo:'Consenso baixo', divergente:'Divergente — revisar', 'sem-consenso':'Sem consenso — revisar' }[c.grau]||c.grau;
  return '<div style="font-size:.9rem"><b style="color:'+cor+'">'+rotulo+'</b> — '+c.apoiam+' fonte(s) a favor · '+c.contra+' contra · de '+c.total+' micro-fonte(s) independente(s).'
    +'<div class="barra-conf" style="margin:8px 0"><div style="width:'+Math.min(100,Math.round((c.apoiam/Math.max(c.total,1))*100))+'%;background:'+cor+'"></div></div>'
    +'<p style="font-size:.82rem;color:var(--cinzN)">'+((c.requer_revisao)?'⚠️ Consenso insuficiente — segue para revisão humana.':'✅ Consenso robusto — veredito sustentado por múltiplas fontes.')+'</p>'
    +(micros&&micros.length?'<div class="row" style="margin-top:8px">'+micros.map(m=>'<span class="pill '+(m.apoio?'s-ver':'s-verm')+'">'+m.fonte+(m.apoio?' ✓':' ✗')+'</span>').join('')+'</div>':'')
    +'</div>';
}
function latencia(ms){ return (ms>1000?(ms/1000).toFixed(1)+'s':Math.round(ms)+'ms'); }
function fmtData(dt){ if(!dt)return ''; try{return new Date(dt).toLocaleDateString('pt-BR');}catch{return dt;} }
function esc(s){ return (s==null?'':String(s)).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }

/* ---------- recentes + stats ---------- */
async function loadRecents(){
  try{
    const r = await fetch(API+'/api/checks?limit=6'); const list = await r.json();
    $('#recents').innerHTML = list.map(c=>'<div class="reg" onclick="abrirDetalhe('+JSON.stringify(c.id)+')" style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;">'
      +'<div>'+seloHTML(c.classification)+'</div><div><div class="tt">'+esc(c.title)+'</div><div class="mt">'+esc(c.summary||'')+'</div></div>'
      +'<span class="pill">'+esc(c.category)+'</span></div>').join('')||'<div class="note">Sem registros ainda.</div>';
  }catch(e){ $('#recents').innerHTML='<div class="note">Backend indisponível.</div>'; }
}
async function abrirDetalhe(id){
  try{
    const r=await fetch(API+'/api/checks?limit=500'); const list=await r.json();
    const c=list.find(x=>x.id===id);
    if(c){ go('inicio'); renderResultado(c); return; }
  }catch(e){}
  go('inicio');
}

async function refreshStats(){
  try{
    const r = await fetch(API+'/api/stats'); const d = await r.json();
    $('#stats').innerHTML =
      '<div class="stat"><div class="num">'+d.total+'</div><div class="lab">Verificações registradas</div></div>'
      +'<div class="stat"><div class="num">'+(d.byStatus.verificado||0)+'</div><div class="lab">Verificadas</div></div>'
      +'<div class="stat"><div class="num">'+(d.byStatus.pendente||0)+'</div><div class="lab">Pendentes de curadoria</div></div>'
      +'<div class="stat"><div class="num">'+(d.byStatus.em_analise||0)+'</div><div class="lab">Em análise</div></div>'
      +'<div class="stat"><div class="num">'+Object.keys(d.byClassification).length+'</div><div class="lab">Selos distintos em uso</div></div>'
      +'<div class="stat"><div class="num">6</div><div class="lab">Classificações previstas</div></div>';
  }catch(e){ $('#stats').innerHTML='<div class="note">Backend indisponível.</div>'; }
}

/* ---------- políticos: agregação real do backend ---------- */

/* ---------- serviços (demo) ---------- */
const PublicEntities = [
  {nome:'Presidência da República',nivel:'União',poder:'Executivo',contato:'gov.br / Planalto',transparencia:'Portal da Transparência',tipo:'Fonte oficial nacional'},
  {nome:'Congresso Nacional',nivel:'União',poder:'Legislativo',contato:'Câmara e Senado',transparencia:'Dados abertos Câmara/Senado',tipo:'Projetos, votações'},
  {nome:'STF / STJ / Tribunais',nivel:'União',poder:'Judiciário',contato:'stf.jus.br',transparencia:'Jurisprudência',tipo:'Decisões'},
  {nome:'Governo Estadual (ex.: MG)',nivel:'Estado',poder:'Executivo',contato:'Portal do governo',transparencia:'Transparência estadual',tipo:'Orçamento, contratos'},
  {nome:'Assembleia Legislativa (ex.: MG)',nivel:'Estado',poder:'Legislativo',contato:'Site da ALMG',transparencia:'Projetos e pauta',tipo:'Legislação estadual'},
  {nome:'Tribunais de Justiça (TJ)',nivel:'Estado',poder:'Judiciário',contato:'tjmg.jus.br',transparencia:'Processos',tipo:'Justiça estadual'},
  {nome:'Prefeitura Municipal',nivel:'Município',poder:'Executivo',contato:'Portal / ouvidoria',transparencia:'Transparência municipal',tipo:'Obras, licitações, folha'},
  {nome:'Câmara de Vereadores',nivel:'Município',poder:'Legislativo',contato:'Site da Câmara',transparencia:'Projetos locais',tipo:'Legislação municipal'},
  {nome:'Defensoria / Ministério Público',nivel:'Federal/Estadual',poder:'Judiciário',contato:'Portal institucional',transparencia:'Atos e termos',tipo:'Fiscalização'}
];
let fNivel='Todos', fPoder='Todos';
function renderFiltros(){
  $('#fltNivel').innerHTML=['Todos','União','Estado','Município'].map(n=>'<button class="'+(fNivel===n?'on':'')+'" onclick="setNivel(\''+n+'\')">'+n+'</button>').join('');
  $('#fltPoder').innerHTML=['Todos','Executivo','Legislativo','Judiciário'].map(n=>'<button class="'+(fPoder===n?'on':'')+'" onclick="setPoder(\''+n+'\')">'+n+'</button>').join('');
}
function setNivel(n){ fNivel=n; renderFiltros(); renderEntidades(); }
function setPoder(n){ fPoder=n; renderFiltros(); renderEntidades(); }
function renderEntidades(){
  $('#entidadesGrid').innerHTML = PublicEntities.filter(e=>(fNivel==='Todos'||e.nivel===fNivel)&&(fPoder==='Todos'||e.poder===fPoder)).map(e=>
    '<div class="reg" onclick="abrirEnte(\''+encodeURIComponent(e.nome)+'\')"><div class="flexT"><div class="tt">'+e.nome+'</div><span class="pill">'+e.nivel+'</span></div>'
    +'<div class="mt">Poder '+e.poder+' · '+e.tipo+'</div>'
    +'<div class="mt" style="margin-top:8px"><b>Transparência:</b> '+e.transparencia+'</div><div class="mt"><b>Contato oficial:</b> '+e.contato+'</div></div>').join('')
    || '<div class="note">Nenhum ente para esses filtros.</div>';
}
function abrirEnte(nome){ const e=PublicEntities.find(x=>x.nome===nome); if(!e)return; $('#entDet').innerHTML='<div class="res"><h2 style="font-size:1.2rem">'+e.nome+'</h2><div class="row" style="margin:8px 0"><span class="pill">'+e.nivel+'</span><span class="pill">Poder '+e.poder+'</span></div><p>'+e.tipo+'. Transparência: '+e.transparencia+'. Contato: '+e.contato+'.</p><p class="fonte">Fonte: páginas oficiais (dados de exemplo).</p></div>'; $('#entDet').classList.remove('oculto'); $('#entDet').scrollIntoView({behavior:'smooth',block:'center'}); }

/* ---------- tira-dúvidas (demo) ---------- */
const PublicQuestions = [
  {q:'O que faz um vereador?',a:'Cria, altera e extingue leis municipais, fiscaliza as contas da prefeitura e o trabalho do prefeito. Atribuições na Constituição (Art. 29) e na Lei Orgânica municipal.',fonte:'Constituição Federal, Art. 29',cat:'Poder Legislativo'},
  {q:'Diferença entre impeachment e queda de ministro?',a:'Impeachment é um processo formal de afastamento por crime de responsabilidade, decidido pelo Legislativo. Não se confunde com exoneração de um ministro.',fonte:'Constituição, arts. 52 e 85',cat:'Poder Executivo'},
  {q:'O que é uma PEC e como é votada?',a:'PEC = Proposta de Emenda à Constituição. Exige dois turnos de votação, com 3/5 dos votos em cada Casa, em dois anos legislativos.',fonte:'Constituição, Art. 60',cat:'Poder Legislativo'},
  {q:'Posso ser demitido sem justa causa?',a:'Sim, mas o empregador deve pagar aviso prévio, 13º proporcional, férias + 1/3 e multa de 40% do FGTS.',fonte:'CLT; Constituição, Art. 7º',cat:'Direitos'},
  {q:'Como abrir protocolo na prefeitura?',a:'Presencialmente no balcão de protocolo, por telefone via ouvidoria ou online. Veja o portal oficial do seu município.',fonte:'Ouvidoria / portal municipal',cat:'Serviço Público'},
  {q:'Como consultar onde o governo gastou dinheiro?',a:'Use o Portal da Transparência (portaltransparencia.gov.br) e as versões estaduais/municipais. Busque por órgão, programa, convênio.',fonte:'Portal da Transparência — CGU',cat:'Transparência'},
  {q:'Vereador pode ter contrato com a prefeitura onde atua?',a:'Em regra é proibido por conflito de interesses (Constituição Art. 37 §10; Lei 8.429/92).',fonte:'Constituição, Art. 37 §10; Lei 8.429/92',cat:'Corrupção'},
  {q:'O que faz o STF?',a:'Mais alta instância do Judiciário e guardião da Constituição. Julga ações constitucionais e autoridades com foro definido.',fonte:'Constituição, Art. 102',cat:'Poder Judiciário'},
  {q:'Qual a função dos tribunais de contas?',a:'Fiscalizam o uso de recursos públicos, aprovando ou rejeitando contas e apontando irregularidades.',fonte:'Constituição, Art. 71',cat:'Controle'},
  {q:'Como peço informações a um órgão público?',a:'Pelo e-SIC e pela Lei de Acesso à Informação (Lei 12.527/11). O pedido deve ser respondido no prazo legal.',fonte:'Lei 12.527/2011 (LAI)',cat:'Transparência'}
];
function renderFaq(){ $('#faqList').innerHTML = PublicQuestions.map(q=>'<div class="reg"><div class="flexT"><div class="tt">'+q.q+'</div><span class="pill">'+q.cat+'</span></div><p style="font-size:.92rem;margin-top:6px">'+q.a+'</p><p class="fonte">Fonte: '+q.fonte+'</p></div>').join(''); }
function buscarPergunta(){ const t=($('#pergunta').value||'').toLowerCase(); const el=$('#qResultado'); if(!t){ el.innerHTML=''; return; } const ach=PublicQuestions.filter(q=>(q.q+' '+q.a).toLowerCase().includes(t)); if(!ach.length){ el.innerHTML='<div class="note">Nenhuma resposta encontrada. Em produção, sua pergunta entra em fila de verificação humana e recebe resposta em até 72h.</div>'; } else { el.innerHTML='<div class="lista">'+ach.map(q=>'<div class="res"><div class="flexT"><b>'+q.q+'</b><span class="pill">'+q.cat+'</span></div><p style="margin-top:8px">'+q.a+'</p><p class="fonte">Fonte: '+q.fonte+'</p></div>').join('')+'</div>'; } }

/* ---------- CURADORIA ---------- */
let curaStatus='Todos';
function renderCuraFiltro(){ $('#curaFiltro').innerHTML=['Todos','pendente','em_analise','verificado'].map(s=>'<button class="'+(curaStatus===s?'on':'')+'" onclick="setCuraFiltro(\''+s+'\')">'+s+'</button>').join(''); }

/* --- Login / permissões --- */
async function fazerLogin(){
  const user=$('#logUser').value, pass=$('#logPass').value;
  try{
    const r=await fetch(API+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,pass})});
    const d=await r.json();
    if(d.token){ TOKEN=d.token; localStorage.setItem('cfb_token',d.token); $('#curaMsg').classList.add('oculto'); $('#curaMsg').innerHTML=''; aplicarCuraUI(); loadCura(); }
    else { $('#curaMsg').classList.remove('oculto'); $('#curaMsg').innerHTML='⚠️ '+d.error; }
  }catch(e){ $('#curaMsg').classList.remove('oculto'); $('#curaMsg').innerHTML='⚠️ Erro ao autenticar.'; }
}
function sairLogin(){ TOKEN=''; localStorage.removeItem('cfb_token'); aplicarCuraUI(); }
function aplicarCuraUI(){
  const ok=!!TOKEN;
  $('#curaLogin').classList.toggle('oculto', ok);
  $('#curaPainel').classList.toggle('oculto', !ok);
  $('#curaSemLogin').classList.toggle('oculto', ok);
}
function setCuraFiltro(s){ curaStatus=s; renderCuraFiltro(); loadCura(); }
async function loadCura(){
  try{
    const r = await fetch(API+'/api/checks?limit=200'); let list = await r.json();
    if(curaStatus!=='Todos') list=list.filter(c=>c.status===curaStatus);
    $('#curaList').innerHTML = list.map(curaCard).join('')||'<div class="note">Nenhum registro com esse status.</div>';
  }catch(e){ $('#curaList').innerHTML='<div class="note">Backend indisponível.</div>'; }
}
function curaCard(c){
  return '<div class="res" id="cura-'+c.id+'">'
    +'<div class="flexT"><div class="row">'+seloHTML(c.classification)+'<b style="font-size:1rem">'+esc(c.title)+'</b></div>'
    +'<select onchange="curaStatusSel(\''+c.id+'\',this.value)">'
    +['pendente','em_analise','verificado'].map(s=>'<option '+(c.status===s?'selected':'')+' value="'+s+'">'+s+'</option>').join('')
    +'</select></div>'
    +'<div style="margin:10px 0"><label>Resumo (em poucas palavras)</label><input type="text" id="sum-'+c.id+'" value="'+esc(c.summary||'')+'"></div>'
    +'<div style="margin:8px 0"><label>Explicação / Apuração</label><textarea id="exp-'+c.id+'" style="min-height:70px">'+esc(c.explanation||'')+'</textarea></div>'
    +'<div style="margin:8px 0"><label>Classificação</label><select id="cls-'+c.id+'">'+Object.keys(seloMap).filter(k=>k!=='misto').map(k=>'<option '+(c.classification===k?'selected':'')+' value="'+k+'">'+seloMap[k].txt+'</option>').join('')+'</select></div>'
    +'<div class="flexT"><span class="fonte">ID '+c.id+' · '+(c.verified_at?fmtData(c.verified_at):'')+'</span>'
    +'<button class="btn peq" onclick="salvarCura(\''+c.id+'\')">💾 Salvar</button></div></div>';
}
async function curaStatusSel(id,val){ await fetch(API+'/api/checks/'+id,{method:'PATCH',headers:authHeaders(),body:JSON.stringify({status:val})}); }
async function salvarCura(id){
  const body={ status:($('#cura-'+id).querySelector('select').value), summary:$('#sum-'+id).value, explanation:$('#exp-'+id).value, classification:$('#cls-'+id).value };
  const r=await fetch(API+'/api/checks/'+id,{method:'PATCH',headers:authHeaders(),body:JSON.stringify(body)});
  if(r.status===401){ alert('Sessão expirada. Faça login novamente.'); aplicarCuraUI(); return; }
  loadCura(); refreshStats();
}

/* ---------- init ---------- */
window.addEventListener('DOMContentLoaded',()=>{
  renderChips(); renderFiltros(); renderEntidades(); renderFaq(); renderCuraFiltro();
  loadRecents(); refreshStats(); renderHistorico(); loadPoliticosReais();
  $('#inp').addEventListener('keydown',e=>{ if(e.key==='Enter') verificar(); });
  $('#url').addEventListener('keydown',e=>{ if(e.key==='Enter') verificar(); });
  $('#pesqTermo').addEventListener('keydown',e=>{ if(e.key==='Enter') pesquisarReal(); });
  $('#cnpjInp').addEventListener('keydown',e=>{ if(e.key==='Enter') consultarCNPJ(); });
  $('#curaPainel').classList.add('oculto');
  (async()=>{ const ok=await checkAuth(); if(!ok) TOKEN=''; aplicarCuraUI(); })();
});
// expor funções usadas por onclick
window.go=go;window.toggleMenu=toggleMenu;window.setExample=setExample;window.verificar=verificar;window.limpar=limpar;
window.abrirDetalhe=abrirDetalhe;window.setNivel=setNivel;window.setPoder=setPoder;window.abrirEnte=abrirEnte;
window.buscarPergunta=buscarPergunta;window.setCuraFiltro=setCuraFiltro;window.curaStatusSel=curaStatusSel;window.salvarCura=salvarCura;
window.fazerLogin=fazerLogin;window.sairLogin=sairLogin;
window.pesquisarReal=pesquisarReal;window.consultarCNPJ=consultarCNPJ;window.removerHistorico=removerHistorico;window.carregarIntegridade=carregarIntegridade;
