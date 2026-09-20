# Changelog — Checa Fato Brasil

> Registro de alterações. Mostra a evolução e reforça a transparência/integridade do projeto.
> Formato: [Data] — resumo (autor).

## [v0.4.0] — 2026-09-20
- **Revisão completa de segurança** (auditoria de código + remediação):
  - 🔴 Corrigido **crash no DELETE** de check (`.filter` em Promise sem `await` → erro 500).
  - 🔴 Corrigido **XSS no frontend** (histórico/recentes/curadoria embutiam strings em `onclick`; agora por índice + escape de atributo) e **breakout no JSON-LD** (`</script>` escapado).
  - 🔴 Adicionada **proteção anti-SSRF**: o buscador de URL bloqueia loopback, RFC1918, link-local, IPv6 privado e o endpoint de metadata da nuvem.
  - 🟠 **Rate limiting** por IP em `/api/verificar`, `/api/pesquisa`, `/api/cnpj` + **bloqueio de brute-force** no login (5 falhas → trava 15 min) + limite de tamanho do corpo de requisição.
  - 🟠 **Cabeçalhos de segurança** (CSP, X-Frame-Options, nosniff, Referrer-Policy) em todas as respostas.
- **Correção de perda de dados (race condition):** a revalidação periódica agora faz *merge* por id sobre o estado atual e usa *mutex* — verificações criadas durante o lote não são mais sobrescritas.
- **Compartilhamento (impacto em desinformação):** cada verificação ganha **página pública** `/c/:id` com card de preview (tags Open Graph/Twitter), **dados estruturados ClaimReview (schema.org)** — padrão global de fact-check (Google Fact Check Markup, usado por agências IFCN) — e botões de compartilhar (WhatsApp/Telegram/X/copiar link), também no resultado do app.
- **Eleições 2026 (1º turno 04/10):** **countdown** no topo da home + no modo eleitoral; 2 novas checagens de base sobre boatos recorrentes de eleição (voto nulo / urna); exemplos do app priorizam o tema eleitoral.
- **SEO/descoberta:** `robots.txt`, `sitemap.xml` dinâmico, meta description + OG no `index.html`, endpoint de leitura pública `/api/checks/:id`.
- (em preparação) banco PostgreSQL em produção; integração Google Fact Check ativa.

## [v0.3.0] — 2026-09-08
- **Revalidação periódica automática** (micro → macro): os registros verificados são reconciliados contra fontes vivas a cada intervalo; sem consenso multi-fonte → sinalizados para revisão humana. Evita informação errada/desatualizada no ar.
- **Consenso multi-fonte** no veredito (Wikipedia, Câmara, fontes oficiais, fact-check externo, base local).
- **Login persistente** com token assinado (JWT-style) — sessão sobrevive a reinício do servidor.
- **Painel de integridade** na aba Transparência (status da revalidação + registros a revisar).
- **Persistência PostgreSQL opcional** via `DATABASE_URL` (padrão continua JSON).
- Correções: busca da Wikipedia sem homônimos; clique em verificação recém-carrega o registro; artefato no CNPJ.

## [v0.2.0]
- Integrações reais: Wikipedia (pt), proposições da Câmara (dados abertos), CNPJ via BrasilAPI, extração de conteúdo de URLs.
- Perfil de agente público com índice agregado; modo eleitoral; histórico de buscas; API pública para imprensa.

## [v0.1.0]
- Versão inicial: motor de verificação (6 selos), análise de linguagem, curadoria humana, serviços públicos por ente/poder, tira-dúvidas, educação midiática, transparência.
