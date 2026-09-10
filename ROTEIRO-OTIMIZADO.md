# 📋 Roteiro Otimizado — Fazer em casa (ordem correta e segura)

> **Escolha recomendada: GitHub Desktop (Rota A).** Roteiro completo para proteger sua propriedade e publicar com link fixo.
> Ferramentas: **Git** + **GitHub Desktop** + **Render**.
> Tempo total estimado: ~40–60 min. Custo: R$ 0 (plano gratuito).

---

## FASE 1 — Git + GitHub (proteger sua propriedade)

### 1.1 Instalar as ferramentas (uma vez)
- **Git:** baixe em https://git-scm.com/downloads e instale (padrões OK). Confirme no terminal/Git Bash: `git --version`.
- **GitHub Desktop:** baixe em https://desktop.github.com e instale.

### 1.2 Criar conta no GitHub (se não tiver)
- https://github.com → **Sign up** → crie usuário + e-mail confirmado.
- Guarde seu usuário (ex.: `seu-usuario`).

### 1.3 Preparar o projeto no computador
1. **Descompacte** o arquivo `checa-fato-brasil-pro.zip` (que você baixou aqui) em uma pasta, ex.: `Documentos/checa-fato-brasil-pro`.
2. Confirme que a pasta contém: `server.js`, `public/`, `.gitignore`, `LICENSE`, `README.md`, `CHANGELOG.md`, `GUIA-*.md`, `Dockerfile`, `.env.example`.
3. (Importante) **NÃO** coloque a pasta `data/` nem nenhum `.env` real — o `.gitignore` já bloqueia.

### 1.4 Criar o repositório e o primeiro commit (com GitHub Desktop)
1. Abra o **GitHub Desktop** → **Sign in** com sua conta GitHub.
2. **File → New repository** → Nome: `checa-fato-brasil` → **Local path**: selecione a pasta do projeto → **Create repository**.
3. No painel esquerdo, marque os arquivos (todos). No campo de mensagem escreva `Versão inicial da Checa Fato Brasil` → **Commit** (botão "Commit to main").
4. **Publish repository** (botão no topo) → escolha **público** (projeto de interesse público) OU **private** (se preferir guardar só para você) → **Publish**.

> ✅ Seu código agora está **no GitHub**, com histórico, backup e licença. **Propriedade protegida.**

### 1.5 Conferências de segurança
- Confirme que **`.env` não aparece** no repositório (o `.gitignore` cuida disso).
- Confirme que o arquivo **`LICENSE`** está lá (marca sua propriedade/autorização de uso).

---

## FASE 2 — Deploy na Render (link fixo que não cai)

### 2.1 Criar conta na Render
- https://render.com → **Sign Up** → entre com **GitHub** (login) → confirme e-mail.

### 2.2 Criar o Web Service
- **New → Web Service** → selecione o repositório `checa-fato-brasil`.
- Configuração:
  - **Name:** `checa-fato-brasil`
  - **Region:** `South America (São Paulo)`
  - **Branch:** `main`
  - **Build Command:** *(deixe vazio)*
  - **Start Command:** `node server.js`
  - **Instance Type:** **Free**

### 2.3 Variáveis de ambiente (segredos — NUNCA no código)
Adicione **uma por uma** (Add Environment Variable → New):
- `ADMIN_USER = editor`
- `ADMIN_PASS` = uma senha forte (ex.: `Cfb!2026Minas`)
- `JWT_SECRET` = um texto aleatório bem longo (letras+números)

> Esses valores ficam **na Render**, não no GitHub. Proteção total.

### 2.4 Publicar
- **Create Web Service** → acompanhe os **Logs** até:
  ```
  ✅ Checa Fato Brasil backend rodando em http://0.0.0.0:8080
  ```
- Quando aparecer **Live**, abra o endereço azul (ex.: `https://checa-fato-brasil.onrender.com`).
- **Teste:** faça uma verificação e entre no painel (usuário `editor` + a senha que você definiu).

---

## FASE 3 — Entendendo o "não cai" (decisão de disponibilidade)

| Plano | Cai? | Custo | Quando usar |
|---|---|---|---|
| **Free** (padrão) | Pausa após ~15 min sem visita; volta sozinho no próximo acesso (~5–10s). Link **fixo**. | R$ 0 | Testar / mostrar / começar |
| **Starter** | **Não pausa** (24/7) | ~US$ 7/mês | Serviço público que deve estar sempre no ar |
| **VPS + systemd** (`Restart=always`) | **Não cai** | ~R$ 20–40/mês ou free tier | Mais robusto e barato a longo prazo |

**Recomendação para você:** comece no **Free** para testar e validar. Quando o projeto "pegar", migre para **Starter** (sem pause) ou **VPS** — os dois garantem o "não cai" real.

---

## FASE 4 — Dados persistentes (importante)
- No **Free**, os dados em `data/` **não persistem** ao reiniciar.
- Para persistir em produção: na Render crie **New → PostgreSQL**, copie a URL e adicione a variável `DATABASE_URL`. **O app já suporta** (muda do JSON para PostgreSQL automaticamente). Assim suas verificações ficam salvas de verdade.

---

## Passos futuros (rotina)
1. **Toda alteração** no código: no GitHub Desktop → **Commit + Push** → a Render reimplanta sozinha.
2. **Integridade/verdade:** mantenha o `CHANGELOG.md` atualizado e as **fontes atribuídas**.
3. Se quiser domínio próprio (`checafatobrasil.com.br`): compre o domínio e adicione em **Settings → Custom Domains** na Render (HTTPS vem automático).

---

## Checklist de conclusão
- [ ] Git + GitHub Desktop instalados
- [ ] Conta no GitHub
- [ ] Projeto descompactado e no repositório (1º commit)
- [ ] `.env` e `data/` **fora** do repositório
- [ ] `LICENSE` e `README` no repositório
- [ ] Conta na Render (login com GitHub)
- [ ] Web Service publicado e **Live**
- [ ] Variáveis `ADMIN_USER`/`ADMIN_PASS`/`JWT_SECRET` configuradas
- [ ] Painel de curadoria funciona no endereço fixo
- [ ] (Opcional) PostgreSQL + `DATABASE_URL` para dados persistentes
- [ ] (Opcional) Domínio próprio
