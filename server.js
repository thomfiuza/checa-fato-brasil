#!/usr/bin/env node
/**
 * Checa Fato Brasil — Backend (backend de verificação)
 * 
 * Servidor sem dependências externas (módulos nativos do Node) para rodar de forma
 * confiável em qualquer ambiente e persistir sem instalar pacotes.
 *
 * Funcionalidades:
 *  - Serve o frontend (public/) na mesma origem (evita CORS no preview).
 *  - API de verificação: analisa texto/URL e busca correspondência em fact-checkers.
 *  - Integração plugável com fontes oficiais e Google Fact Check Tools (via chave env).
 *  - Persistência de verificações em JSON (banco local) com trilha de auditoria.
 *  - Painel de curadoria humana (workflow pendente -> em_analise -> verificado).
 *
 * Suba com:  node server.js
 * Confirme .env / variáveis de ambiente antes de produção.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';
// Senha do painel de curadoria (em produção use variável de ambiente forte).
const ADMIN_USER = process.env.ADMIN_USER || 'editor';
const ADMIN_PASS = process.env.ADMIN_PASS || 'checafato';
// Segredo para assinar tokens persistentes (JWT-style). Troque em produção.
const JWT_SECRET = process.env.JWT_SECRET || 'checa-fato-demo-secret-altere-producao';
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS || (12*3600*1000)); // 12h
const MUTATE = 'MUTATE'; // permissão de escrita no painel
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CHECKS_FILE = path.join(DATA_DIR, 'checks.json');
const REVALID_MS = Number(process.env.REVALID_MS || (15*60*1000)); // revalidação periódica (15 min)
// Opcional: chave de API do Google Fact Check Tools (ClaimReview search API).
const GCC_API_KEY = process.env.GCC_API_KEY || '';

/* Calendário eleitoral 2026 (Resolução TSE nº 23.760/2026) */
const ELEICOES_2026 = {
  primeiro_turno: '2026-10-04T08:00:00-03:00',
  segundo_turno: '2026-10-25T08:00:00-03:00'
};
function diasPara(iso){
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}
function proximoTurno(){
  const p1 = new Date(ELEICOES_2026.primeiro_turno);
  const agora = new Date();
  if (agora < p1) return { turno: 1, data: '2026-10-04', dias: diasPara(ELEICOES_2026.primeiro_turno), segundo_turno: '2026-10-25' };
  return { turno: 2, data: '2026-10-25', dias: diasPara(ELEICOES_2026.segundo_turno), segundo_turno: null };
}
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://checa-fato-brasil.onrender.com';

/* ------------------------------------------------------------------ */
/*  Autenticação persistente (token assinado HMAC)                     */
/*  Permite que a sessão sobreviva a reinício do servidor.             */
/* ------------------------------------------------------------------ */
function b64u(s){ return Buffer.from(s).toString('base64url'); }
function unB64u(s){ return Buffer.from(s, 'base64url').toString('utf8'); }
function hmac(payload){ return crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url'); }
function issueToken(){
  const payload = { user: ADMIN_USER, perms:[MUTATE], exp: Date.now() + TOKEN_TTL_MS };
  const body = b64u(JSON.stringify(payload));
  return body + '.' + hmac(body);
}
function verifyToken(tok){
  const parts = (tok||'').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (hmac(body) !== sig) return null;
  try { const p = JSON.parse(unB64u(body)); if (p.exp < Date.now()) return null; return p; }
  catch { return null; }
}
function authed(req){
  const h = (req.headers['authorization'] || '');
  const t = h.replace(/^Bearer\s+/i,'');
  return !!verifyToken(t);
}

/* ------------------------------------------------------------------ */
/*  Persistência — JSON local (padrão) OU PostgreSQL (se configurado)  */
/*  Para usar PostgreSQL: npm i pg  e  defina DATABASE_URL.            */
/* ------------------------------------------------------------------ */
const DATABASE_URL = process.env.DATABASE_URL || '';
let pg = null;
try { pg = require('pg'); } catch (e) { pg = null; }
const USE_PG = !!(DATABASE_URL && pg);
let pool = null;
if (USE_PG) {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
}

function ensureData() {
  if (!USE_PG) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CHECKS_FILE)) {
      fs.writeFileSync(CHECKS_FILE, JSON.stringify(seedChecks(), null, 2));
    }
  } else {
    // cria a tabela se não existir (schema mínimo) e aplica o seed se vier vazia
    pool.query(`CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )`)
      .then(() => pool.query('SELECT count(*)::int AS n FROM checks'))
      .then(r => {
        if (r.rows[0].n === 0) {
          console.log('PG: tabela vazia — aplicando seed de exemplo');
          return Promise.all(seedChecks().map(c =>
            pool.query(
              'INSERT INTO checks(id, payload, created_at) VALUES($1,$2,now()) ON CONFLICT (id) DO NOTHING',
              [c.id, JSON.stringify(c)]
            )
          ));
        }
      })
      .catch(e => console.error('PG init:', e.message));
  }
}
async function loadChecks() {
  if (!USE_PG) { try { return JSON.parse(fs.readFileSync(CHECKS_FILE, 'utf8')); } catch { return []; } }
  try {
    const r = await pool.query('SELECT payload FROM checks ORDER BY created_at DESC');
    return r.rows.map(x => x.payload);
  } catch { return []; }
}
async function saveChecks(checks) {
  if (!USE_PG) { return fs.writeFileSync(CHECKS_FILE, JSON.stringify(checks, null, 2)); }
  try {
    // upsert simples em lote
    for (const c of checks) {
      const id = c.id;
      await pool.query('INSERT INTO checks(id, payload, created_at) VALUES($1,$2,now()) ON CONFLICT (id) DO UPDATE SET payload=$2', [id, JSON.stringify(c)]);
    }
  } catch (e) { console.error('PG save:', e.message); }
}

/* ------------------------------------------------------------------ */
/*  Palavras/indicadores para o motor de análise                       */
/* ------------------------------------------------------------------ */
const SENSACIONAIS = [
  'urgente','urgentíssimo','notícia bombástica','escândalo','explosivo','absurdo',
  'inacreditável','chocante','compartilhe antes que apaguem','ninguém quer que você saiba',
  'saiu agora','veja agora','exclusivo','revelação','segredo','eles escondem','caiu essa',
  'terror','catástrofe','traição','apocalipse','colapso'
];
const QUALIFICADORES_DE_DUVIDA = [
  'talvez','supostamente','dizem','alegadamente','boa','imagina','será que','reza a lenda',
  'segundo alguns','não é de hoje'
];
const DOMINIOS_OFICIAIS = [
  'gov.br','tse.jus.br','ibge.gov.br','camara.leg.br','senado.leg.br','stf.jus.br',
  'stj.jus.br','portaltransparencia.gov.br','cgu.gov.br','planalto.gov.br',
  'ministérios','jusbrasil','mpsp','tces','tcu.gov.br'
];
const FM_FACTCHECKERS = ['aosfatos.org','lupa.uol.com.br','projetocomprova.com.br','boatos.org','estadaoverifica'];
const PALAVRAS_CLICKBAIT = ['clique aqui','você não vai acreditar','isso vai te deixar','o que ninguém te conta'];

/* ------------------------------------------------------------------ */
/*  Análise heurística de linguagem                                    */
/* ------------------------------------------------------------------ */
function scoreLinguagem(text) {
  const t = text.toLowerCase();
  const words = (t.match(/[a-zà-ÿ0-9]+/g) || []);
  const total = Math.max(words.length, 1);
  let sens = 0, click = 0, oficiais = 0;
  SENSACIONAIS.forEach(w => { if (t.includes(w)) sens++; });
  QUALIFICADORES_DE_DUVIDA.forEach(w => { if (t.includes(w)) sens += 0.5; });
  PALAVRAS_CLICKBAIT.forEach(w => { if (t.includes(w)) click++; });
  let officialTargets = 0;
  DOMINIOS_OFICIAIS.forEach(d => { if (t.includes(d)) officialTargets++; });

  // proporção de MAIÚSCULAS (grito) e exclamações
  const up = (t.match(/[A-ZÀ-Ý]/g) || []).length;
  const letters = (t.match(/[A-Za-zà-ÿÀ-Ý]/g) || []).length || 1;
  const shout = up / letters > 0.25 ? 1 : 0;
  const excl = (text.match(/!/g) || []).length;

  // score de linguagem manipulativa 0..100
  let score = (sens * 12) + (click * 15) + (shout * 20) + (excl * 2);
  score = Math.min(100, Math.round(score));
  return {
    manipulativeScore: score,
    indicators: {
      sensationalism: sens,
      clickbait: click,
      shout,
      exclamations: excl,
      oficialDomains: officialTargets
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Extração de conteúdo de uma URL (título + meta + texto bruto)      */
/* ------------------------------------------------------------------ */
/* Bloqueia alvos de rede interna (anti-SSRF): loopback, RFC1918, link-local,
   IPv6 privado e o endpoint de metadata da nuvem (169.254.169.254). */
function isPrivateHost(hostname) {
  const h = String(hostname||'').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) return true;
  return false;
}
function fetchURL(target, redirectLeft = 4) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(target); if (!/^https?:$/.test(url.protocol)) throw new Error('proto'); }
    catch { return reject(new Error('URL inválida')); }
    if (isPrivateHost(url.hostname)) return reject(new Error('URL bloqueada: redes internas não são permitidas.'));
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'ChecaFatoBrasil/1.0 (+public verification bot)', 'Accept-Language':'pt-BR,pt;q=0.9' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectLeft > 0) {
        res.resume();
        const base = new URL(res.headers.location, target).toString();
        return resolve(fetchURL(base, redirectLeft - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve(parseHTML(body, target)));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
  });
}
function stripTags(html) { return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function parseHTML(html, url) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
  let text = stripTags(html).slice(0, 4000);
  return { title: title.trim(), description: metaDesc.trim(), text, url };
}

/* ------------------------------------------------------------------ */
/*  Busca em fact-checkers (Google Fact Check Tools API)               */
/* ------------------------------------------------------------------ */
function searchFactCheckAPI(query) {
  return new Promise((resolve) => {
    if (!GCC_API_KEY) return resolve({ used: false, results: [] });
    const base = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';
    const u = `${base}?query=${encodeURIComponent(query)}&languageCode=pt-BR&key=${encodeURIComponent(GCC_API_KEY)}`;
    https.get(u, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const results = (j.claims || []).slice(0, 5).map(c => ({
            text: c.text, claimant: c.claimant, date: c.claimDate,
            review: c.claimReview && { rating: c.claimReview[0].textualRating, publisher: c.claimReview[0].publisher && c.claimReview[0].publisher.name, url: c.claimReview[0].url }
          }));
          resolve({ used: true, results });
        } catch { resolve({ used: true, results: [] }); }
      });
    }).on('error', () => resolve({ used: true, results: [] }));
  });
}

/* ------------------------------------------------------------------
   CONSENSO MICRO -> MACRO (verificação multi-fonte)
   O veredito macro só é considerado robusto quando um número mínimo de
   micro-fontes independentes converge para a mesma classificação.
   Isso evita que uma única fonte "puxada errada" derrube o resultado.
   ------------------------------------------------------------------ */
const MICRO_FONTES = ['wikipedia','camara','oficiais','factcheck_externo','base_local'];
function nivelConsenso(sinais) {
  // sinais: [{fonte, apoio:boolean|null, peso}]  null = neutro (não opina)
  const totais = sinais.filter(s => s.apoio !== null);
  const apoiam = totais.filter(s => s.apoio).length;
  const contra = totais.filter(s => !s.apoio).length;
  const n = totais.length;
  let grau; let requer_revisao;
  if (n === 0) { grau = 'sem-consenso'; requer_revisao = true; }
  else if (apoiam >= 2 && apoiam > contra) { grau = 'alto'; requer_revisao = false; }
  else if (apoiam === 1 && contra === 0) { grau = 'baixo'; requer_revisao = true; }
  else if (contra >= 1 && apoiam === 0) { grau = 'divergente'; requer_revisao = true; }
  else { grau = 'medio'; requer_revisao = (apoiam === contra); }
  return { grau, apoiam, contra, total: n, requer_revisao };
}
/* coleta micro-sinais de fontes independentes para um dado */
function coletarMicroSinais(termo, lang, fetched, external, local, props) {
  const sinais = [];
  // 1) Wikipedia — se encontrou um conceito que bate com o tema, dá um sinal de contexto verificável
  sinais.push({ fonte:'wikipedia', apoio: props && props.wikipedia ? true : null, peso:1 });
  // 2) Câmara — proposições relevantes indicam o assunto tramitando (ex.: voto impresso)
  sinais.push({ fonte:'camara', apoio: props && props.proposicoes && props.proposicoes.length ? true : null, peso:1 });
  // 3) Fontes oficiais no texto — presença de domínio governamental
  sinais.push({ fonte:'oficiais', apoio: lang.indicators.oficialDomains >= 1 ? true : (lang.indicators.oficialDomains === 0 ? false : null), peso:2 });
  // 4) Fact-check externo consolidado
  let extSinal = null;
  if (external && external.results && external.results.length) {
    const algum = external.results.some(r => r.review && /verdadeiro|fact/i.test(r.review.rating));
    const algumFalso = external.results.some(r => r.review && /falso|false/i.test(r.review.rating));
    extSinal = algum ? true : (algumFalso ? false : null);
  }
  sinais.push({ fonte:'factcheck_externo', apoio: extSinal, peso:3 });
  // 5) Base local — correspondência forte com verificação anterior
  sinais.push({ fonte:'base_local', apoio: local && local.score >= 0.35 ? true : null, peso:1 });
  return sinais;
}

/* ------------------------------------------------------------------ */
/*  Local: busca por similaridade na base de checks                    */
/* ------------------------------------------------------------------ */
function matchLocal(query, checks) {
  const q = query.toLowerCase();
  const qwords = new Set((q.match(/[a-zà-ÿ0-9]+/g) || []).filter(w => w.length > 3));
  let best = null, bestScore = 0;
  checks.forEach(c => {
    const hay = ((c.title||'') + ' ' + (c.summary||'') + ' ' + (c.explanation||'')).toLowerCase();
    const haywords = new Set((hay.match(/[a-zà-ÿ0-9]+/g) || []).filter(w => w.length > 3));
    let inter = 0; qwords.forEach(w => { if (haywords.has(w)) inter++; });
    const score = inter / Math.max(qwords.size, 1);
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return { best, score: bestScore };
}

/* ------------------------------------------------------------------ */
/*  Motor principal de verificação                                     */
/* ------------------------------------------------------------------ */
function classify(_scores, lang, external) {
  // Combina: linguagem manipulativa (0-100) + presença de fontes oficiais
  const manip = lang.manipulativeScore;
  const oficiais = lang.indicators.oficialDomains;
  const extIsTrue = external && external.results.some(r => r.review && /verdadeiro|true|fact/i.test(r.review.rating));
  const extIsFalse = external && external.results.some(r => r.review && /falso|false/i.test(r.review.rating));

  let classification = 'inverificavel';
  let conf = Math.max(0, 100 - manip * 0.6 + oficiais * 8);
  if (extIsFalse) { classification = 'falso'; conf = Math.min(95, 60 + oficiais * 5); }
  else if (extIsTrue) { classification = 'verdadeiro'; conf = Math.min(95, 60 + oficiais * 5); }
  else if (manip >= 55 || (oficiais === 0 && manip >= 40)) { classification = 'enganoso'; }
  else if (manip >= 30) { classification = 'impreciso'; }
  else if (oficiais >= 2) { classification = 'verdadeiro'; conf = Math.min(90, 55 + oficiais * 7); }
  else { classification = 'inverificavel'; }
  conf = Math.max(20, Math.min(95, Math.round(conf)));
  return { classification, confidence: conf };
}

async function verify(input) {
  const start = Date.now();
  const checks = await loadChecks();
  let text = (input.text || '').trim();
  let fetched = null;
  let fetchedText = '';

  if (input.url) {
    try {
      fetched = await fetchURL(input.url);
      fetchedText = (fetched.title + ' ' + fetched.description + ' ' + fetched.text).trim();
    } catch (e) {
      fetchedText = ''; // segue com o que houver
    }
  }
  const haystack = (text + ' ' + fetchedText).trim() || (input.url || '');
  const lang = scoreLinguagem(haystack);

  // busca externa (se configurada) + local
  const external = input.url || text ? await searchFactCheckAPI((text || (fetched && fetched.title) || '').slice(0, 120)) : { used: false, results: [] };
  const local = matchLocal(haystack, checks);
  const res = classify(null, lang, external);

  // prioriza local se a correspondência for forte
  let classification = res.classification, confidence = res.confidence, sources = [], explanation = '', summary = '';
  if (local.best && local.score >= 0.35) {
    classification = local.best.classification;
    confidence = Math.round(60 + local.score * 30);
    sources = (local.best.sources || []).concat(fetched ? ['Fonte original: ' + fetched.url] : []);
    explanation = local.best.explanation || '';
    summary = local.best.summary || '';
  } else {
    summary = 'Classificação indicada com base na análise de linguagem e fontes.';
    explanation = buildExplanation(lang, fetched, external);
    sources = [];
    if (fetched) sources.push('Conteúdo extraído de: ' + fetched.url);
    (external.results || []).forEach(r => sources.push(`Fact-check: ${r.review.publisher} — ${r.review.rating}`));
    // sugestão de fontes oficiais de referência para verificação humana
    const cat = inferCategory(haystack);
    officialPortals(cat).slice(0,3).forEach(p => sources.push(`Fonte oficial de referência: ${p.nome} — ${p.url} (${p.fonte})`));
    if (lang.indicators.oficialDomains === 0) sources.push('Nenhuma fonte oficial (gov.br, TSE, IBGE...) detectada no conteúdo.');
  }

  // contexto real: Wikipedia + proposições da Câmara (dados abertos)
  let pesquisa = null;
  try {
    const tema = (fetched && fetched.title) || text.slice(0, 90) || (input.url || '');
    pesquisa = await pesquisaAmpla(tema.split(/[;,.]/)[0]);
  } catch (e) { pesquisa = null; }

  // Consenso micro -> macro entre fontes independentes
  const sinais = coletarMicroSinais(haystack, lang, fetched, external, local, pesquisa);
  const consenso = nivelConsenso(sinais);

  const record = {
    id: 'c' + crypto.randomBytes(6).toString('hex'),
    title: (fetched && fetched.title) || text.slice(0, 140) || 'Consulta sem título',
    content: haystack.slice(0, 5000),
    source_url: input.url || '',
    classification,
    summary,
    explanation,
    sources,
    category: inferCategory(haystack),
    politician_mentioned: inferPolitician(haystack),
    verified_at: new Date().toISOString(),
    // status robusto: exige consenso para "verificado"; senão vai à curadoria
    status: (classification === 'inverificavel' || consenso.requer_revisao) ? 'pendente' : 'verificado',
    confidence,
    lang,
    latency_ms: Date.now() - start,
    local_match: local.score >= 0.35,
    factcheck_used: external.used,
    consenso: { grau: consenso.grau, apoiam: consenso.apoiam, contra: consenso.contra, total: consenso.total, requer_revisao: consenso.requer_revisao },
    microfontes: sinais.filter(s => s.apoio !== null).map(s => ({ fonte: s.fonte, apoio: s.apoio })),
    ultima_revalidacao: new Date().toISOString(),
    pesquisa: pesquisa ? {
      wikipedia: pesquisa.wikipedia,
      proposicoes: pesquisa.proposicoes.slice(0, 5),
      fontes_oficiais: pesquisa.fontes_oficiais
    } : null
  };
  checks.unshift(record);
  await saveChecks(checks.slice(0, 500));
  return record;
}

function buildExplanation(lang, fetched, external) {
  const bits = [];
  if (lang.manipulativeScore >= 40) bits.push('O texto apresenta forte apelo emocional e linguagem sensacionalista, típicos de conteúdo enganoso.');
  else bits.push('A linguagem do conteúdo não apresenta sinais fortes de manipulação.');
  if (lang.indicators.oficialDomains === 0) bits.push('Nenhuma fonte oficial foi identificada, o que reduz a confiabilidade.');
  else bits.push(`Foram encontrados indicadores de fontes oficiais (${lang.indicators.oficialDomains} domínio(s) reconhecido(s)).`);
  if (fetched) bits.push(`Título extraído da fonte: "${fetched.title}".`);
  if (external && external.results.length) bits.push('A busca em fact-checkers retornou correspondências (ver fontes).');
  else if (external && external.used) bits.push('A busca em fact-checkers não retornou registros para esta consulta.');
  return bits.join(' ');
}
/* ------------------------------------------------------------------ */
/*  Fontes oficiais em tempo real (diretório de portais oficiais)      */
/*  Em produção: consultar APIs abertas do gov.br, TSE, IBGE, Câmara,  */
/*  Senado, tribunais e portais de transparência em tempo real.        */
/* ------------------------------------------------------------------ */
const OFFICIAL_PORTALS = {
  eleicoes: [
    { nome:'Tribunal Superior Eleitoral (TSE)', url:'https://www.tse.jus.br', fonte:'Legislação e dados eleitorais' },
    { nome:'Portal do TSE — dados abertos', url:'https://dados.tse.jus.br', fonte:'Candidatos, eleições, prestação de contas' },
    { nome:'Câmara dos Deputados', url:'https://www.camara.leg.br', fonte:'Projetos de lei e votações' },
    { nome:'Senado Federal', url:'https://www12.senado.leg.br', fonte:'Projetos e matérias' }
  ],
  corrupcao: [
    { nome:'Portal da Transparência (CGU)', url:'https://portaltransparencia.gov.br', fonte:'Convênios, repasses, auditorias' },
    { nome:'Tribunal de Contas da União (TCU)', url:'https://portal.tcu.gov.br', fonte:'Contas e fiscalização' },
    { nome:'Portal de Convênios', url:'https://portal.convenios.gov.br', fonte:'Convênios federais' }
  ],
  economia: [
    { nome:'Ministério da Fazenda / Receita', url:'https://www.gov.br/receitafederal', fonte:'Tributos e dados' },
    { nome:'Banco Central do Brasil', url:'https://www.bcb.gov.br', fonte:'Juros, inflação' },
    { nome:'IBGE', url:'https://www.ibge.gov.br', fonte:'Estatísticas oficiais' }
  ],
  saude: [
    { nome:'Ministério da Saúde', url:'https://www.gov.br/saude', fonte:'Saúde pública' },
    { nome:'ANVISA', url:'https://www.gov.br/anvisa', fonte:'Vigilância sanitária' }
  ],
  educacao: [ { nome:'Ministério da Educação (MEC)', url:'https://www.gov.br/mec', fonte:'Educação' } ],
  seguranca: [ { nome:'Ministério da Justiça / Segurança', url:'https://www.gov.br/mj', fonte:'Segurança pública' } ],
  meio_ambiente: [ { nome:'Ministério do Meio Ambiente', url:'https://www.gov.br/mma', fonte:'Clima e ambiente' } ],
  internacional: [ { nome:'Ministério das Relações Exteriores', url:'https://www.gov.br/mre', fonte:'Relações internacionais' } ],
  outro: [
    { nome:'Portal da Transparência', url:'https://portaltransparencia.gov.br', fonte:'Dados públicos' },
    { nome:'gov.br', url:'https://www.gov.br', fonte:'Serviços e informações oficiais' }
  ]
};
function officialPortals(category){ return OFFICIAL_PORTALS[category] || OFFICIAL_PORTALS.outro; }

function inferPolitician(t) {
  const names = ['deputado','senador','presidente','governador','prefeito','vereador','ministro','secretário','tse','stf'];
  const hit = names.find(n => t.toLowerCase().includes(n));
  return hit ? (hit === 'tse' ? 'TSE' : hit === 'stf' ? 'STF' : hit) : null;
}

/* ==================================================================
   INTEGRAÇÕES REAIS — APIs públicas (sem chave)
   ================================================================== */

/* Consulta genérica a APIs externas (JSON) */
function getJSON(target, timeout=9000) {
  return new Promise((resolve) => {
    let url; try { url = new URL(target); } catch { return resolve(null); }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent':'ChecaFatoBrasil/1.0 (verificação pública)', 'Accept':'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

/* --- Wikipedia (pt): busca e resumo de conceitos / temas --- */
// Mapa de termos conhecidos -> título exato (evita homônimos como "Gabriel Pec" para "PEC")
const TERMOS_WIKI = {
  'pec':'Proposta de emenda à Constituição',
  'lai':'Lei de Acesso à Informação',
  'lei de acesso à informação':'Lei de Acesso à Informação','lei de acesso':'Lei de Acesso à Informação',
  'voto impresso':'Voto impresso no Brasil',
  'urna':'Urna eletrônica','urna eletrônica':'Urna eletrônica','eleit':'Eleição no Brasil','eleição':'Eleição no Brasil',
  'impeachment':'Impeachment','crime de responsabilidade':'Crime de responsabilidade',
  'constituição':'Constituição do Brasil',
  'stf':'Supremo Tribunal Federal','supremo':'Supremo Tribunal Federal',
  'tse':'Tribunal Superior Eleitoral','justiça eleitoral':'Justiça Eleitoral do Brasil',
  'senador':'Senado Federal','senado':'Senado Federal','camara':'Câmara dos Deputados','câmara':'Câmara dos Deputados',
  'deputado':'Câmara dos Deputados',
  'cpi':'Comissão Parlamentar de Inquérito',
  'transparência':'Lei de Acesso à Informação',
  'reforma trabalhista':'Reforma trabalhista no Brasil',
  'fgts':'Fundo de Garantia do Tempo de Serviço',
  'clt':'Consolidação das Leis do Trabalho',
  'inflação':'Inflação','selic':'Taxa Selic','imposto':'Imposto no Brasil',
  'sus':'Sistema Único de Saúde','saúde':'Sistema Único de Saúde',
  'poder legislativo':'Poder Legislativo do Brasil','poder executivo':'Poder Executivo no Brasil','poder judiciário':'Poder Judiciário do Brasil',
  'auxílio':'Assistência social no Brasil'
};
function matchTermo(termo){
  const t = String(termo||'').toLowerCase();
  if (TERMOS_WIKI[t]) return TERMOS_WIKI[t];
  // procura qualquer chave do mapa contida no termo
  for (const k of Object.keys(TERMOS_WIKI)) if (t.includes(k)) return TERMOS_WIKI[k];
  return null;
}
async function wikipediaBusca(termo) {
  if (!termo) return null;
  const conhecido = matchTermo(termo);
  let title = conhecido || termo;
  // tenta a roda de redirecionamento do título exato/conhecido
  let ext = await getJSON('https://pt.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exsentences=6&redirects=1&titles=' + encodeURIComponent(title));
  let page = null;
  if (ext && ext.query && ext.query.pages) {
    const pages = Object.values(ext.query.pages); page = pages[0];
    if (!page || page.missing !== undefined) page = null;
  }
  // se o título exato falhou, tenta busca por prefixo/título, não por texto livre
  if (!page) {
    const search = await getJSON('https://pt.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=5&srsearch=intitle:' + encodeURIComponent(conhecido || termo));
    let found = (search && search.query && search.query.search || []).find(s => s.title.indexOf(search.query.search[0] && search.query.search[0].title) >= 0 ? true : false);
    const best = (search && search.query && search.query.search && search.query.search[0]);
    title = best ? best.title : title;
    ext = await getJSON('https://pt.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exsentences=6&redirects=1&titles=' + encodeURIComponent(title));
    if (ext && ext.query && ext.query.pages) { const pg = Object.values(ext.query.pages); page = pg[0]; if (!pg || !pg[0] || pg[0].missing !== undefined) page = null; }
  }
  if (!page || !page.extract) return null;
  return {
    titulo: page.title,
    resumo: (page.extract || '').slice(0, 1200),
    url: 'https://pt.wikipedia.org/wiki/' + encodeURIComponent((page.title || title).replace(/ /g, '_'))
  };
}

/* --- Câmara dos Deputados: proposições (dados abertos) --- */
async function camaraProposicoes(termo, ano) {
  const a = ano || (new Date().getFullYear()); const t = (termo || '').trim();
  const ficha = (p) => `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${p.id}`;
  // 1) tenta busca por termo; 2) fallback: proposições recentes do ano
  if (t) {
    const d = await getJSON(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?itens=5&termo=${encodeURIComponent(t)}&ordem=DESC&ordenarPor=numero`);
    if (d && d.dados && d.dados.length) return d.dados.map(p => ({ sigla:(p.siglaTipo||'')+' '+(p.numero||'')+'/'+(p.ano||''), ementa:(p.ementa||'').slice(0,240), url: ficha(p) }));
  }
  const d = await getJSON(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?ano=${a}&itens=5&ordem=DESC&ordenarPor=numero`);
  if (!d || !d.dados) return [];
  return d.dados.map(p => ({ sigla:(p.siglaTipo||'')+' '+(p.numero||'')+'/'+(p.ano||''), ementa:(p.ementa||'').slice(0,240), url: ficha(p) }));
}

/* --- Banco Central: dados econômicos (índice IGP/IPCA, Selic) --- */
async function bcIndicadores() {
  const d = await getJSON('https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/ultimos/6?formato=json');
  if (!Array.isArray(d) || !d.length) return null;
  return { serie: 'Selic (% a.m.)', pontos: d.slice(-6).map(p => ({ data: p.data, valor: p.valor })) };
}

/* --- BrasilAPI: consulta CNPJ real --- */
async function cnpjReal(cnpj) {
  const limpo = String(cnpj || '').replace(/\D/g, '').slice(0, 14);
  if (limpo.length !== 14) return { ok:false, error:'CNPJ deve ter 14 dígitos.' };
  const d = await getJSON('https://brasilapi.com.br/api/cnpj/v1/' + limpo);
  if (!d) return { ok:false, error:'Não retornou dados (verifique o CNPJ).' };
  if (d.message) return { ok:false, error: d.message };
  return { ok:true, cnpj: d.cnpj, razaoSocial: d.razao_social, nomeFantasia: d.nome_fantasia,
    naturezaJuridica: d.natureza_juridica, porte: d.porte, situacao: d.descricao_situacao_cadastral,
    municipio: d.municipio, uf: d.uf, cnae: d.cnae_fiscal_descricao };
}

/* --- Pesquisa ampla (real) para o Tira-Dúvidas / Cidadão --- */
async function pesquisaAmpla(termo) {
  const wik = await wikipediaBusca(termo);
  const props = await camaraProposicoes(termo);
  const of = officialPortals(inferCategory(termo)).slice(0, 4);
  return { termo, wikipedia: wik, proposicoes: props, fontes_oficiais: of, gerado_em: new Date().toISOString() };
}
function inferCategory(t) {
  const map = [
    ['eleicoes',['eleit','voto','candidato','urna','eleição']],
    ['corrupcao',['corrup','propina','desvio','lavagem','licita','superfatura']],
    ['economia',['econom','inflação','imposto','orçamento','pib','salário','reajuste']],
    ['saude',['saúde','vacina','sus','hospital','doenç']],
    ['educacao',['educaç','escola','ensino','universidade']],
    ['seguranca',['segurança','crime','polícia','violência']],
    ['meio_ambiente',['meio ambiente','clima','desmatament','amazônia']],
    ['internacional',['internacional','outro país','onu','estados unidos']]
  ];
  for (const [cat, kw] of map) if (kw.some(k => t.toLowerCase().includes(k))) return cat;
  return 'outro';
}

/* ------------------------------------------------------------------
   REVALIDAÇÃO PERIÓDICA AUTOMÁTICA
   Roda a cada REVALID_MS. Reconcilia cada registro "verificado" contra
   fontes vivas e re-sinaliza o consenso. Se o consenso cai (ex.: fonte
   puxada errada, informação desatualizada), o registro volta a ser
   sinalizado como "revisar" para a curadoria humana (micro -> macro).
   ------------------------------------------------------------------ */
let revalidando = false;
let statsRevalidacao = { ultima: null, revisados: 0, revalidados: 0, erros: 0 };
async function revalidarLote() {
  if (revalidando) return { ...statsRevalidacao, ocupado: true }; // evita execuções concorrentes
  revalidando = true;
  try {
    const checks = await loadChecks();
    let revisados = 0, revalidados = 0;
    const atualizados = []; // registros com campos de revalidação recalculados
    for (const c of checks) {
      if (!c || c.status !== 'verificado') continue;
      // re-análise heurística do conteúdo armazenado
      const lang = scoreLinguagem((c.content || c.title || '').slice(0, 2000));
      let pesquisa = null;
      try {
        const tema = (c.title || '').split(/[;,.]/)[0];
        pesquisa = await pesquisaAmpla(tema.slice(0, 90) || 'outro');
      } catch (e) { pesquisa = null; }
      const local = { score: 0 }; // no re-check não força match local
      const sinais = coletarMicroSinais((c.content || c.title || ''), lang, null, { used:c.factcheck_used, results:[] }, local, pesquisa);
      const consenso = nivelConsenso(sinais);
      revalidados++;
      const campos = {
        consenso: { grau: consenso.grau, apoiam: consenso.apoiam, contra: consenso.contra, total: consenso.total, requer_revisao: consenso.requer_revisao },
        microfontes: sinais.filter(s => s.apoio !== null).map(s => ({ fonte: s.fonte, apoio: s.apoio })),
        ultima_revalidacao: new Date().toISOString(),
        revisar: !!(consenso.requer_revisao || consenso.grau === 'divergente' || consenso.grau === 'sem-consenso')
      };
      if (campos.revisar) { campos.motivo_revisao = 'Consenso multi-fonte insuficiente na revalidação.'; revisados++; }
      atualizados.push({ id: c.id, campos });
    }
    if (revalidados) {
      if (USE_PG) {
        // upsert por id — não afeta outros registros
        await saveChecks(atualizados.map(a => { const c = checks.find(x => x.id === a.id); return Object.assign({}, c, a.campos); }));
      } else {
        // merge por id sobre o estado ATUAL — nunca sobrescreve registros novos
        const current = await loadChecks();
        const byId = new Map(current.map(x => [x.id, x]));
        for (const a of atualizados) {
          const existente = byId.get(a.id);
          if (existente) byId.set(a.id, Object.assign(existente, a.campos));
        }
        await saveChecks(Array.from(byId.values()));
      }
    }
    statsRevalidacao = { ultima: new Date().toISOString(), revisados, revalidados, erros: 0 };
    return statsRevalidacao;
  } finally {
    revalidando = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Seed de dados de exemplo                                           */
/* ------------------------------------------------------------------ */
function seedChecks() {
  return [
    { id:'n1', title:'Governo federal aprova aumento de 30% no salário dos vereadores', classification:'enganoso', summary:'O projeto existe, mas o percentual e o alcance foram distorcidos.', explanation:'A proposta que circula trata de reajuste a servidores de determinadas Câmaras, não de todos os vereadores do país, e o percentual não corresponde a 30% em caráter nacional.', sources:['Câmara dos Deputados — Projeto de Lei','Constituição Federal, Art. 29'], category:'eleicoes', verified_at:'2026-08-10', politician_mentioned:'Vereadores', status:'verificado', confidence:78 },
    { id:'n2', title:'Eleições no Brasil voltam a usar voto impresso obrigatório', classification:'falso', summary:'O voto impresso não voltou a ser obrigatório no país.', explanation:'Não há norma em vigor determinando voto impresso no Brasil. O sistema eletrônico segue em uso.', sources:['TSE — nota oficial','Constituição Federal, Art. 14'], category:'eleicoes', verified_at:'2026-08-18', politician_mentioned:'TSE', status:'verificado', confidence:90 },
    { id:'n3', title:'Voto nulo derruba o candidato e o cargo fica vago', classification:'falso', summary:'Boato recorrente desmentido pelo TSE: o voto nulo não provoca reeleição/renovação.', explanation:'O percentual de votos nulos não gera efeito jurídico sobre a eleição: não há regra que "derrube" candidato ou deixe cargo vago em razão de votos nulos. A votação segue a normalidade do pleito.', sources:['TSE — notas sobre boatos eleitorais','Código Eleitoral, Art. 221'], category:'eleicoes', verified_at:'2026-09-01', politician_mentioned:'TSE', status:'verificado', confidence:92 },
    { id:'n4', title:'Urna eletrônica pode ser manipulada pelo WhatsApp', classification:'falso', summary:'A urna não possui qualquer conectividade para comunicação por aplicativos de mensagem.', explanation:'As urnas eletrônicas não têm acesso à internet nem a redes de celular durante a votação; não existe canal pelo qual uma mensagem pudesse alterar o voto. A totalização é auditável por hash (QR Code) e acompanha a cadeia de custódia do TSE.', sources:['TSE — manual do eleitor e notas técnicas','Resolução TSE sobre auditoria de urnas'], category:'eleicoes', verified_at:'2026-09-02', politician_mentioned:'TSE', status:'verificado', confidence:90 },
    { id:'n5', title:'Vacina X não protege e fez mal a milhares de pessoas', classification:'enganoso', summary:'Mistura fato e exagero sem evidência.', explanation:'Há relatos isolados de eventos adversos, mas não há evidência de dano em "milhares".', sources:['Ministério da Saúde','ANVISA'], category:'saude', verified_at:'2026-08-15', politician_mentioned:null, status:'verificado', confidence:74 },
    { id:'n6', title:'Obra municipal superfaturada em 200%', classification:'impreciso', summary:'O número foi distorcido; o excedente real é menor e há processo em análise.', explanation:'O dado de "200%" não é o apurado. Há um desvio apontado por órgão de controle, em percentual menor.', sources:['Tribunal de Contas do Estado','Portal da Transparência municipal'], category:'corrupcao', verified_at:'2026-08-12', politician_mentioned:'Prefeitura', status:'em_analise', confidence:66 },
    { id:'n7', title:'Presidente vai privatizar a saúde', classification:'inverificavel', summary:'Não há evidência suficiente para confirmar ou negar.', explanation:'Não existe documento oficial, projeto de lei ou pronunciamento que sustente essa afirmação.', sources:['Nenhuma fonte oficial encontrada'], category:'saude', verified_at:'2026-08-20', politician_mentioned:null, status:'pendente', confidence:30 },
    { id:'n8', title:'Deputado prometeu construir mil escolas', classification:'verdadeiro', summary:'Declaração confirmada por registro oficial.', explanation:'O pronunciamento é real e consta de registro parlamentar.', sources:['Câmara dos Deputados — registro'], category:'educacao', verified_at:'2026-08-19', politician_mentioned:'Deputado', status:'verificado', confidence:85 },
    { id:'n9', title:'Chargem satírica sobre novo imposto', classification:'satira', summary:'Conteúdo de humor, não notícia.', explanation:'A imagem é uma charge satírica. Não deve ser tratada como reportagem factual.', sources:['Veículo de origem — seção de humor'], category:'outro', verified_at:'2026-08-17', politician_mentioned:null, status:'verificado', confidence:80 }
  ];
}

/* ------------------------------------------------------------------ */
/*  Servidor HTTP (frontend + API)                                     */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------
   Página pública de verificação (/c/:id)
   - Card de preview para WhatsApp/Facebook/LinkedIn (tags OG)
   - Dados estruturados ClaimReview (schema.org) — padrão global de
     fact-checking (Google Fact Check Markup), usado por agências IFCN
   ------------------------------------------------------------------ */
const SELO_META = {
  verdadeiro:   { txt:'✓ Verdadeiro',   cor:'#22c55e' },
  falso:        { txt:'✕ Falso',        cor:'#ef4444' },
  enganoso:     { txt:'⚠ Enganoso',     cor:'#f59e0b' },
  impreciso:    { txt:'± Impreciso',    cor:'#a78bfa' },
  inverificavel:{ txt:'? Inverificável',cor:'#94a3b8' },
  satira:       { txt:'☺ Sátira',       cor:'#60a5fa' }
};
const CLAIM_SCORE = { verdadeiro:5, satira:3, impreciso:3, enganoso:2, inverificavel:1, falso:0 };
function escH(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderCheckPage(c) {
  const m = SELO_META[c.classification] || SELO_META.inverificavel;
  const claim = c.title || 'Verificação';
  const desc = (c.summary || c.explanation || '').slice(0, 190);
  const pageUrl = SITE_ORIGIN + '/c/' + c.id;
  const conf = (typeof c.confidence === 'number') ? c.confidence : 50;
  const shareText = '"' + claim + '" — ' + m.txt + ' (índice ' + conf + '/100). ' + desc + ' Confira: ' + pageUrl;
  const wa = 'https://wa.me/?text=' + encodeURIComponent(shareText);
  const tg = 'https://t.me/share/url?url=' + encodeURIComponent(pageUrl) + '&text=' + encodeURIComponent(shareText);
  const xs = 'https://x.com/intent/tweet?text=' + encodeURIComponent(shareText);
  const sources = (c.sources || []).map(s => '<li>' + escH(s) + '</li>').join('') || '<li>Nenhuma fonte confirmada para este caso.</li>';
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'ClaimReview',
    'itemReviewed': { '@type': 'CreativeWork', 'name': claim, 'text': (c.content || '').slice(0, 1000) },
    'author': { '@type': 'Organization', 'name': 'Checa Fato Brasil', 'url': SITE_ORIGIN },
    'datePublished': c.verified_at || new Date().toISOString(),
    'reviewRating': { '@type': 'Rating', 'ratingValue': (CLAIM_SCORE[c.classification] != null ? CLAIM_SCORE[c.classification] : 1), 'bestRating': 5, 'worstRating': 0 }
  };
  const consenso = c.consenso ? ('<div class="box"><h3>Consenso multi-fonte (micro → macro)</h3>'
    + '<p>' + c.consenso.apoiam + ' fonte(s) a favor · ' + c.consenso.contra + ' contra · de ' + c.consenso.total + ' micro-fonte(s) independentes. Grau: <b>' + escH(c.consenso.grau) + '</b>.</p></div>') : '';
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>' + escH(claim) + ' — ' + m.txt + ' | Checa Fato Brasil</title>'
    + '<meta name="description" content="' + escH(desc) + '">'
    + '<link rel="canonical" href="' + pageUrl + '">'
    + '<meta property="og:type" content="website">'
    + '<meta property="og:site_name" content="Checa Fato Brasil">'
    + '<meta property="og:locale" content="pt_BR">'
    + '<meta property="og:url" content="' + pageUrl + '">'
    + '<meta property="og:title" content="' + escH(claim) + ' — ' + m.txt + '">'
    + '<meta property="og:description" content="' + escH(desc) + '">'
    + '<meta property="og:image" content="' + SITE_ORIGIN + '/og-brand.png">'
    + '<meta property="og:image:width" content="1200">'
    + '<meta property="og:image:height" content="630">'
    + '<meta name="twitter:card" content="summary">'
    + '<meta name="twitter:image" content="' + SITE_ORIGIN + '/og-brand.png">'
    + '<meta name="twitter:title" content="' + escH(claim) + ' — ' + m.txt + '">'
    + '<meta name="twitter:description" content="' + escH(desc) + '">'
    + '<script type="application/ld+json">' + JSON.stringify(jsonld).replace(/</g, '\\u003c') + '</script>'
    + '<style>'
    + 'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#0a141f;color:#eef4f8;line-height:1.55}'
    + '.bar{height:6px;background:linear-gradient(90deg,#009c3b,#ffdf00)}'
    + '.wrap{max-width:760px;margin:0 auto;padding:24px 20px 48px}'
    + '.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;flex-wrap:wrap;gap:8px}'
    + '.logo{font-weight:800;font-size:1.15rem;letter-spacing:.3px}'
    + '.logo span{color:#2fd8c4}'
    + '.pill{display:inline-block;padding:4px 12px;border-radius:999px;border:1px solid #2a3b4d;font-size:.78rem;color:#9fb3c2}'
    + '.selo{display:inline-block;padding:10px 22px;border-radius:999px;font-size:1.35rem;font-weight:800;color:' + m.cor + ';background:' + m.cor + '22;border:2px solid ' + m.cor + ';margin:6px 0 14px}'
    + 'h1{font-size:1.55rem;line-height:1.3;margin:10px 0 6px}'
    + '.claim{background:#101c2a;border:1px solid #1e3042;border-left:4px solid ' + m.cor + ';border-radius:10px;padding:14px 16px;color:#c2d2de;font-size:.98rem;margin:14px 0}'
    + '.box{background:#101c2a;border:1px solid #1e3042;border-radius:12px;padding:16px 18px;margin:14px 0}'
    + '.box h3{margin:0 0 8px;font-size:.82rem;letter-spacing:1.5px;text-transform:uppercase;color:#2fd8c4}'
    + '.box p,.box li{color:#c2d2de;font-size:.95rem;margin:4px 0}'
    + '.box ul{margin:6px 0 0;padding-left:18px}'
    + '.meta{color:#5f7d92;font-size:.8rem;margin-top:10px}'
    + '.meter{height:10px;background:#1e3042;border-radius:999px;overflow:hidden;margin:8px 0 4px}'
    + '.meter div{height:100%;background:' + m.cor + ';width:' + conf + '%}'
    + '.share{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}'
    + '.share a,.share button{padding:10px 16px;border-radius:999px;border:1px solid #2fd8c4;color:#2fd8c4;background:transparent;font-weight:700;font-size:.9rem;cursor:pointer;text-decoration:none}'
    + '.share .cta{background:#2fd8c4;color:#0a141f;border-color:#2fd8c4}'
    + 'footer{margin-top:28px;border-top:1px solid #1e3042;padding-top:16px;color:#5f7d92;font-size:.82rem}'
    + 'footer a{color:#2fd8c4;text-decoration:none}'
    + '</style></head><body>'
    + '<div class="bar"></div><div class="wrap">'
    + '<div class="top"><div class="logo">Checa <span>Fato</span> Brasil</div><span class="pill">Verificação pública · status: ' + escH(c.status || 'pendente') + '</span></div>'
    + '<div class="selo">' + m.txt + '</div>'
    + '<h1>' + escH(claim) + '</h1>'
    + '<div class="claim"><b>Conteúdo analisado:</b> ' + escH((c.content || '').slice(0, 500)) + '</div>'
    + (c.summary ? '<div class="box"><h3>Em poucas palavras</h3><p>' + escH(c.summary) + '</p></div>' : '')
    + (c.explanation ? '<div class="box"><h3>A fundo</h3><p>' + escH(c.explanation) + '</p></div>' : '')
    + '<div class="box"><h3>Fontes usadas</h3><ul>' + sources + '</ul></div>'
    + '<div class="box"><h3>Índice de confiança</h3><div class="meter"><div></div></div><p><b>' + conf + '%</b></p></div>'
    + consenso
    + '<div class="box"><h3>Compartilhe esta verificação</h3><div class="share">'
    + '<a class="cta" target="_blank" rel="noopener" href="' + wa + '">WhatsApp</a>'
    + '<a target="_blank" rel="noopener" href="' + tg + '">Telegram</a>'
    + '<a target="_blank" rel="noopener" href="' + xs + '">X / Twitter</a>'
    + '<button onclick="navigator.clipboard.writeText(\'' + pageUrl + '\').then(function(){alert(\'Link copiado!\')})">📋 Copiar link</button>'
    + '</div><p class="meta">Compartilhe com o resultado e a trilha de auditoria — ajude a combater a desinformação.</p></div>'
    + '<p class="meta">Categoria: ' + escH(c.category || 'outro') + (c.politician_mentioned ? ' · Agente citado: ' + escH(c.politician_mentioned) : '') + ' · Verificado em ' + escH((c.verified_at||'').slice(0,10)) + ' · ID ' + escH(c.id) + (c.ultima_revalidacao ? ' · Última revalidação ' + escH(c.ultima_revalidacao.slice(0,10)) : '') + '</p>'
    + '<footer><a href="' + SITE_ORIGIN + '">← Fazer minha própria verificação</a><br>'
    + 'Compromisso de neutralidade: verificamos afirmações e dados, nunca pessoas, partidos ou ideologias. '
    + 'IA sugere, curadoria humana valida. Dados abertos: <a href="' + SITE_ORIGIN + '/api/public">API pública</a> (CC-BY-SA 4.0).</footer>'
    + '</div></body></html>';
}

const PUBLIC_DIR = path.join(__dirname, 'public');
function sendHTML(res, file) {
  fs.readFile(path.join(PUBLIC_DIR, file), (e, data) => {
    if (e) { res.writeHead(404, SEC_HEADERS); return res.end('404'); }
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control':'no-cache' }, SEC_HEADERS));
    res.end(data);
  });
}
function json(res, code, obj) {
  res.writeHead(code, Object.assign({ 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type' }, SEC_HEADERS));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let overflow = false;
    req.on('data', c => {
      body += c;
      if (body.length > 200000) { overflow = true; req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) { resolve({}); return; }
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Segurança: rate limiting + proteção contra brute force             */
/* ------------------------------------------------------------------ */
const buckets = new Map();
function clientIp(req){ return (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress || '?'; }
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 20000) { for (const [k, v] of buckets) if (now - v.start > v.win) buckets.delete(k); }
  b.win = windowMs;
  return b.n <= limit;
}
function tooMany(req, route, limit, windowMs) {
  return !rateLimit(route + ':' + clientIp(req), limit, windowMs);
}
/* bloqueio de login: 5 falhas em 10 min -> trava por 15 min */
const loginFail = new Map();
function loginLocked(ip){ const f = loginFail.get(ip); return !!f && f.n >= 5 && (Date.now() - f.start) < 10*60*1000; }
function loginBump(ip){ const f = loginFail.get(ip) || { start: Date.now(), n: 0 }; f.n++; loginFail.set(ip, f); }
function loginReset(ip){ loginFail.delete(ip); }

/* Cabeçalhos de segurança aplicados a todas as respostas */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer-when-downgrade',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return json(res, 200, {});

  // ---- API ----
  if (url.pathname === '/api/health') return json(res, 200, { ok:true, gcc: !!GCC_API_KEY, time:new Date().toISOString() });

  if (url.pathname === '/api/auth' && req.method === 'POST') {
    const ip = clientIp(req);
    if (loginLocked(ip)) return json(res, 429, { error:'Muitas tentativas. Aguarde 15 minutos.' });
    const body = await readBody(req);
    if (body.user === ADMIN_USER && body.pass === ADMIN_PASS) {
      loginReset(ip);
      return json(res, 200, { token: issueToken(), user: ADMIN_USER });
    }
    loginBump(ip);
    return json(res, 401, { error:'Credenciais inválidas.' });
  }
  if (url.pathname === '/api/auth' && req.method === 'GET') {
    return json(res, 200, { authed: authed(req), user: authed(req) ? ADMIN_USER : null });
  }

  if (url.pathname === '/api/verificar' && req.method === 'POST') {
    if (tooMany(req, 'verificar', 8, 60*1000)) return json(res, 429, { error:'Muitas requisições. Aguarde um minuto.' });
    const body = await readBody(req);
    if (!body.text && !body.url) return json(res, 400, { error:'Informe texto ou URL.' });
    try {
      const rec = await verify(body);
      return json(res, 200, rec);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (url.pathname === '/api/checks' && req.method === 'GET') {
    const checks = await loadChecks();
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    return json(res, 200, checks.slice(0, limit));
  }

  if (url.pathname === '/api/checks' && req.method === 'POST') {
    if(!authed(req)) return json(res, 401, { error:'Autorização necessária.' });
    const body = await readBody(req);
    const checks = await loadChecks();
    const rec = { id:'c'+crypto.randomBytes(6).toString('hex'), created_date:new Date().toISOString(), status:'pendente', ...body };
    checks.unshift(rec); await saveChecks(checks);
    return json(res, 201, rec);
  }

  // ---- Painel de curadoria: atualizar status / editar ----
  const upd = url.pathname.match(/^\/api\/checks\/([^/]+)$/);
  if (upd && req.method === 'PATCH') {
    if(!authed(req)) return json(res, 401, { error:'Autorização necessária.' });
    const body = await readBody(req);
    const checks = await loadChecks();
    const idx = checks.findIndex(c => c.id === upd[1]);
    if (idx === -1) return json(res, 404, { error:'Não encontrado' });
    checks[idx] = { ...checks[idx], ...body, updated_date: new Date().toISOString() };
    await saveChecks(checks);
    return json(res, 200, checks[idx]);
  }
  if (upd && req.method === 'DELETE') {
    if(!authed(req)) return json(res, 401, { error:'Autorização necessária.' });
    const checks = (await loadChecks()).filter(c => c.id !== upd[1]);
    await saveChecks(checks);
    return json(res, 200, { ok:true });
  }

  // ---- Estatísticas ----
  if (url.pathname === '/api/oficiais') {
    const q = (url.searchParams.get('q')||'').toLowerCase();
    const cat = inferCategory(q || 'outro');
    return json(res, 200, { categoria: cat, portais: officialPortals(cat) });
  }

  if (url.pathname === '/api/stats') {
    const checks = await loadChecks();
    const byStatus = {}; checks.forEach(c => byStatus[c.status] = (byStatus[c.status]||0)+1);
    return json(res, 200, { total: checks.length, byStatus, byClassification: (()=>{const o={};checks.forEach(c=>o[c.classification]=(o[c.classification]||0)+1);return o;})() });
  }

  // ---- Integridade: status da revalidação periódica e registros a revisar ----
  if (url.pathname === '/api/integridade') {
    const checks = await loadChecks();
    const aRevisar = checks.filter(c => c.revisar).map(c => ({ id:c.id, title:c.title, classification:c.classification, motivo:c.motivo_revisao, ultima_revalidacao:c.ultima_revalidacao }));
    const comConsensoAlto = checks.filter(c => c.consenso && c.consenso.grau === 'alto').length;
    return json(res, 200, {
      status_revalidacao: statsRevalidacao,
      total: checks.length,
      a_revisar: aRevisar,
      com_consenso_alto: comConsensoAlto,
      regra: 'Micro->Macro: o veredito só é robusto quando >=2 micro-fontes independentes convergem. Registros sem consenso vão à revisão humana.'
    });
  }

  // ---- Pesquisa ampla real (Tira-Dúvidas / contexto) ----
  if (url.pathname === '/api/pesquisa') {
    if (tooMany(req, 'pesquisa', 10, 60*1000)) return json(res, 429, { error:'Muitas requisições. Aguarde um minuto.' });
    const q = (url.searchParams.get('q')||'').trim();
    if (!q) return json(res, 400, { error:'Informe q' });
    const r = await pesquisaAmpla(q.slice(0, 120));
    return json(res, 200, r);
  }

  // ---- Consulta real de CNPJ (transparência) ----
  if (url.pathname === '/api/cnpj') {
    if (tooMany(req, 'cnpj', 10, 60*1000)) return json(res, 429, { error:'Muitas requisições. Aguarde um minuto.' });
    const c = (url.searchParams.get('cnpj')||'');
    const r = await cnpjReal(c);
    return json(res, 200, r);
  }

  // ---- Perfil de político (agrega verificações por nome/cargo) ----
  if (url.pathname === '/api/politicos') {
    const checks = await loadChecks();
    const mapa = {};
    checks.forEach(c => {
      if (!c.politician_mentioned) return;
      const k = c.politician_mentioned;
      if (!mapa[k]) mapa[k] = { nome:k, verificacoes:0, verdadeiro:0, falso:0, enganoso:0, impreciso:0, categorias:{}, checks:[] };
      const m = mapa[k]; m.verificacoes++;
      const cl = c.classification;
      if (cl==='verdadeiro') m.verdadeiro++; else if (cl==='falso') m.falso++; else if (cl==='enganoso') m.enganoso++; else if (cl==='impreciso') m.impreciso++;
      m.categorias[c.category] = (m.categorias[c.category]||0)+1;
      m.checks.push({ title:c.title, classification:c.classification, verified_at:c.verified_at, summary:c.summary });
    });
    const lista = Object.values(mapa).map(m => {
      const precisa = m.verificacoes ? Math.round((m.verdadeiro/m.verificacoes)*100) : 0;
      m.indice = precisa;
      m.checks = m.checks.slice(0, 6);
      return m;
    }).sort((a,b)=> b.verificacoes - a.verificacoes);
    return json(res, 200, { politicos: lista });
  }

  // ---- API pública para imprensa (somente leitura; dados abertos) ----
  if (url.pathname === '/api/public') {
    let checks = await loadChecks();
    const cat = url.searchParams.get('categoria');
    const cls = url.searchParams.get('classificacao');
    if (cat) checks = checks.filter(c => c.category === cat);
    if (cls) checks = checks.filter(c => c.classification === cls);
    const pub = checks.slice(0, 100).map(c => ({
      id:c.id, title:c.title, classification:c.classification, summary:c.summary,
      explanation:c.explanation, sources:c.sources, category:c.category,
      politician_mentioned:c.politician_mentioned, verified_at:c.verified_at, status:c.status
    }));
    return json(res, 200, { fonte:'Checa Fato Brasil — dados públicos de verificação', total: pub.length, licenca:'CC-BY-SA 4.0 (atribuição obrigatória)', itens: pub });
  }

  // ---- Modo eleitoral (painel de monitoramento) ----
  if (url.pathname === '/api/eleitoral') {
    const checks = await loadChecks();
    const cats = { eleicoes: [], corrupcao: [] };
    checks.forEach(c => { if (cats[c.category]) cats[c.category].push(c); });
    const alertas = checks.filter(c => c.category==='eleicoes' && c.classification==='falso').slice(0, 10)
      .map(c => ({ titulo:c.title, classificacao:c.classification, verificado_em:c.verified_at }));
    return json(res, 200, {
      periodo:'Monitoramento contínuo',
      alertas_falsos_eleitorais: alertas,
      total_checagens_eleitorais: cats.eleicoes.length,
      fonte_oficial: 'https://www.tse.jus.br',
      dica:'Durante eleições, o app ativa alertas em tempo real sobre boatos.',
      proximo_turno: proximoTurno()
    });
  }

  // ---- Leitura pública de um registro (pela API) ----
  if (url.pathname.match(/^\/api\/checks\/[^/]+$/) && req.method === 'GET') {
    const checks = await loadChecks();
    const c = checks.find(x => x.id === url.pathname.split('/')[3]);
    if (!c) return json(res, 404, { error:'Não encontrado' });
    return json(res, 200, c);
  }

  // ---- Página pública de verificação (link compartilhável) ----
  if (url.pathname.match(/^\/c\/[^/]+$/) && req.method === 'GET') {
    const checks = await loadChecks();
    const c = checks.find(x => x.id === url.pathname.split('/')[2]);
    if (!c) {
      res.writeHead(404, Object.assign({ 'Content-Type':'text/html; charset=utf-8' }, SEC_HEADERS));
      return res.end('<meta charset="utf-8"><title>404</title><body style="font-family:system-ui;background:#0a141f;color:#eef4f8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>404</h1><p>Verificação não encontrada.</p><p><a style="color:#2fd8c4" href="/">← Checa Fato Brasil</a></p></div></body>');
    }
    res.writeHead(200, Object.assign({ 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache' }, SEC_HEADERS));
    return res.end(renderCheckPage(c));
  }

  // ---- SEO básico ----
  if (url.pathname === '/robots.txt') {
    res.writeHead(200, Object.assign({ 'Content-Type':'text/plain; charset=utf-8' }, SEC_HEADERS));
    return res.end('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ' + SITE_ORIGIN + '/sitemap.xml\n');
  }
  if (url.pathname === '/sitemap.xml') {
    const urls = ['/', '/c/'].length; // (sitemap dinâmico abaixo)
    const checks = await loadChecks();
    const rows = ['<url><loc>' + SITE_ORIGIN + '/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>'];
    checks.slice(0, 500).forEach(c => rows.push('<url><loc>' + SITE_ORIGIN + '/c/' + c.id + '</loc><lastmod>' + (c.verified_at||'').slice(0,10) + '</lastmod></url>'));
    res.writeHead(200, Object.assign({ 'Content-Type':'application/xml; charset=utf-8' }, SEC_HEADERS));
    return res.end('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + rows.join('') + '</urlset>');
  }

  // ---- Frontend SPA ----
  if (url.pathname === '/' || url.pathname === '/index.html') return sendHTML(res, 'index.html');
  if (url.pathname === '/app.js') { res.writeHead(200, Object.assign({'Content-Type':'application/javascript; charset=utf-8', 'Cache-Control':'max-age=300'}, SEC_HEADERS)); return fs.createReadStream(path.join(PUBLIC_DIR,'app.js')).pipe(res); }
  if (url.pathname === '/styles.css') { res.writeHead(200, Object.assign({'Content-Type':'text/css; charset=utf-8', 'Cache-Control':'max-age=300'}, SEC_HEADERS)); return fs.createReadStream(path.join(PUBLIC_DIR,'styles.css')).pipe(res); }
  if (url.pathname === '/og-brand.png') { res.writeHead(200, Object.assign({'Content-Type':'image/png', 'Cache-Control':'public, max-age=86400'}, SEC_HEADERS)); return fs.createReadStream(path.join(PUBLIC_DIR,'og-brand.png')).pipe(res); }
  if (url.pathname === '/favicon.svg') { res.writeHead(200, Object.assign({'Content-Type':'image/svg+xml', 'Cache-Control':'public, max-age=86400'}, SEC_HEADERS)); return fs.createReadStream(path.join(PUBLIC_DIR,'favicon.svg')).pipe(res); }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

  return json(res, 404, { error:'Rota não encontrada' });
});

ensureData();
server.listen(PORT, HOST, () => {
  console.log(`✅ Checa Fato Brasil backend rodando em http://${HOST}:${PORT}`);
  console.log(`   Integração Google Fact Check: ${GCC_API_KEY ? 'configurada' : 'desativada (exporte GCC_API_KEY)'}`);
  console.log(`   Revalidação periódica: a cada ${Math.round(REVALID_MS/60000)} min`);
});
// agendador periódico de integridade (micro -> macro)
if (REVALID_MS > 0) {
  setInterval(() => { revalidarLote().catch(()=>{}); }, REVALID_MS);
  // roda uma vez na subida para garantir consistência inicial
  setTimeout(() => { revalidarLote().catch(()=>{}); }, 2000);
}
