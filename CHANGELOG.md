# Changelog — Checa Fato Brasil

> Registro de alterações. Mostra a evolução e reforça a transparência/integridade do projeto.
> Formato: [Data] — resumo (autor).

## [Unreleased]
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
