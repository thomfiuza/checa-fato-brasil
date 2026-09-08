# Checa Fato Brasil — Plataforma Nacional de Educação, Verificação e Transparência Pública

App validador de notícias políticas e transparência pública, com motor de verificação,
painel de curadoria humana e cobertura dos três poderes e de todos os níveis federativos.

> **Compromisso de neutralidade:** verifica **afirmações e dados**, nunca pessoas,
> partidos ou ideologias. Sempre com **fonte pública oficial** e trilha de auditoria.

## Como rodar

```bash
cd checa-fato-brasil-pro
node server.js
# abre em http://localhost:8080
```

Sem dependências externas (usa apenas módulos nativos do Node).

### Ativar verificação externa (recomendado em produção)
Copie `.env.example` para seu ambiente e defina `GCC_API_KEY` (Google Fact Check Tools)
para o motor cruzar com agências de fact-check certificadas.

## Estrutura
```
server.js          backend (API + motor de verificação + persistência)
public/
  index.html       frontend (SPA)
  app.js           lógica de frontend
  styles.css       responsivo (mobile + desktop)
data/checks.json   banco local (gerado automaticamente)
.env.example       variáveis de ambiente
```

## Funcionalidades
- **Verificação com consenso micro → macro:** o veredito só é robusto quando ≥2 micro-fontes independentes (Wikipedia, Câmara, fontes oficiais, fact-check, base local) convergem. Sem consenso → revisão humana.
- **Revalidação periódica automática:** os registros verificados são reconciliados contra fontes vivas; informação sem consenso forte é sinalizada para revisão (painel de integridade).
- **Verificação** por texto e URL (extrai o conteúdo da página real, analisa linguagem e cruza fontes).
- **Taxonomia de 6 selos**: verdadeiro / falso / enganoso / impreciso / inverificável / sátira.
- **Métricas de linguagem** (sensacionalismo, clickbait, grito, domínios oficiais) e índice de confiança.
- **Pesquisa real (dados vivos):** resumo da **Wikipedia (pt)** + **proposições da Câmara** (dados abertos) no resultado e no Tira-Dúvidas; **consulta real de CNPJ** (BrasilAPI/Receita); **extração de conteúdo de URLs** reais.
- **Painel de curadoria humana** com login/permissões: workflow pendente → em análise → verificado; IA sugere, humano decide.
- **Perfil de agente público** agregando verificações da base e índice de veracidade.
- **Modo eleitoral** com contador de checagens e alertas de conteúdo falso.
- **Histórico de verificações do usuário** (localStorage, no navegador).
- **API pública** para imprensa (dados abertos em JSON, CC-BY-SA).
- **Serviços públicos** por ente e por poder (federal, estadual, municipal) e **educação midiática**.
- **Trilha de auditoria** (fonte, autor, data, status, métricas).
- **Neutralidade radical**: verifica afirmações/dados, nunca pessoas, partidos ou ideologias.

## API principal
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/verificar` | Analisa `{text, url}` → classificação + fontes + contexto real |
| GET | `/api/pesquisa?q=` | Pesquisa real (Wikipedia + Câmara + fontes oficiais) |
| GET | `/api/cnpj?cnpj=` | Consulta real de CNPJ (BrasilAPI/Receita) |
| GET | `/api/politicos` | Perfis de agentes públicos com índice agregado |
| GET | `/api/eleitoral` | Painel do modo eleitoral |
| GET | `/api/public` | API pública (filtros `categoria` / `classificacao`) |
| GET | `/api/checks` | Lista verificações |
| POST | `/api/checks` | Cria registro (requer auth) |
| PATCH | `/api/checks/:id` | Atualiza (curadoria, requer auth) |
| DELETE | `/api/checks/:id` | Remove (requer auth) |
| GET | `/api/stats` / `/api/health` | Estatísticas / saúde |

Veja **DEPLOY.md** para publicar em um link fixo.
