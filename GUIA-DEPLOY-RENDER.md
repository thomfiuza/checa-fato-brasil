# 🚀 Guia Didático — Publicar a Checa Fato Brasil com link fixo (na Render)

> **Resultado:** você termina com um endereço definitivo tipo `https://checa-fato-brasil.onrender.com` **que fica no ar e não muda**, e que qualquer pessoa pode abrir.
> **Tempo estimado:** 15–25 minutos. **Custo:** R$ 0 (plano gratuito). **Não precisa saber programar** — siga os passos.

---

## Antes de começar (2 coisas prontas)
1. **Código no GitHub** — siga o `GUIA-GIT-GITHUB.md` (subir o projeto para o seu GitHub). A Render puxa o código de lá.
2. **Saber onde está a pasta.** Vamos usar a pasta `checa-fato-brasil-pro`, que contém `server.js`, `public/`, `Dockerfile`, `.env.example`.

---

## Parte 1 — Criar conta na Render

1. Abra **https://render.com** no navegador.
2. Clique em **Sign Up / Get Started**.
3. Escolha a opção de login com **GitHub** (recomendado — facilita a conexão com seu repositório) e autorize.
4. Confirme o e-mail. Pronto, você está dentro.

---

## Parte 2 — Conectar seu repositório

1. No painel da Render, clique em **New +** (canto superior direito).
2. Escolha **Web Service**.
3. Na tela seguinte, selecione o repositório onde você subiu a **Checa Fato Brasil** (ex.: `checa-fato-brasil`).
   - Se não aparecer, clique em **Connect account** e autorize o acesso ao GitHub.

---

## Parte 3 — Configurar o serviço

Na tela de configuração, preencha exatamente:

| Campo | O que colocar |
|---|---|
| **Name** | `checa-fato-brasil` (ou o nome que quiser) |
| **Region** | `South America (São Paulo)` — fica mais rápido no Brasil |
| **Branch** | `main` |
| **Runtime / Root Directory** | deixe vazio (usa a raiz do repo) |
| **Build Command** | **deixe vazio** (o projeto não compila — é Node puro) |
| **Start Command** | `node server.js` |
| **Instance Type** | **Free** (grátis) |

> ⚠️ **Importante:** se a Render pedir um "Build Command", deixe vazio mesmo — o app não instala nada. Se pedir `npm start`, use `node server.js`.

### Configure as variáveis de ambiente (segredos de produção)
Role até **Environment** → **Environment Variables** → **Add Environment Variable** e adicione **uma por uma**:

| Key | Value (exemplo) | Obrigatório? |
|---|---|---|
| `ADMIN_USER` | `editor` | ✅ |
| `ADMIN_PASS` | `UmaSenhaMUITOForte123` | ✅ (troque!) |
| `JWT_SECRET` | `texto-aleatorio-bem-longo-com-letras-e-numeros` | ✅ |
| `REVALID_MS` | `900000` | opcional (15 min) |
| `GCC_API_KEY` | *(sua chave do Google Fact Check, se tiver)* | opcional |

> **NUNCA** coloque senha/chave no código — só nessas variáveis.

---

## Parte 4 — Publicar (Deploy)

1. Clique em **Create Web Service** (ou **Deploy**).
2. A Render baixa seu repositório, instala e inicia o servidor. Acompanhe no **Logs** até aparecer:
   ```
   ✅ Checa Fato Brasil backend rodando em http://0.0.0.0:8080
   Revalidação periódica: a cada 15 min
   ```
3. Quando aparecer **Live**, clique no endereço azul (ex.: `https://checa-fato-brasil.onrender.com`).
4. **Teste:** abra o app, faça uma verificação, entre no painel com seu `editor`/senha.

---

## Parte 5 — Link fixo e "não cai": entenda o plano gratuito

- O plano **Free** da Render **pausa** o serviço após ~15 min sem visitas e o **reinicia** no próximo acesso. Ou seja: pode demorar alguns segundos na primeira visita do dia ("spin up"), mas o **endereço nunca muda** e volta sozinho.
- Como você quer um link que **"não cai" de verdade** (disponibilidade contínua), você tem duas opções:
  - **Opção A (grátis, com pause curto):** manter no Free. Bom para testar e para mostrar (o link é permanente).
  - **Opção B (uptime 24/7):** usar o plano **Starter** (pago, ~US$ 7/mês) que **não pausa**. É o ideal para um serviço público que deve estar sempre no ar.
  - **Opção C (sem custo mensal e sem pause):** VPS (veja `DEPLOY.md` → Opção B) com `systemd` e `Restart=always`. É o mais robusto e barato a longo prazo.

---

## Parte 6 — Atualizações futuras (como você atualiza o site)

Depois de publicado, cada vez que você mudar o código:
1. Faça os commits no GitHub (`git add . && git commit -m "..." && git push`).
2. A **Render detecta o push automaticamente** e reimplanta (deploy automático). Você também pode clicar em **Manual Deploy → Deploy latest commit** no painel.

---

## Parte 7 — (Opcional) Dominário próprio com HTTPS

O endereço `.onrender.com` já vem com **HTTPS** e funciona. Se quiser um domínio próprio (ex.: `checafatobrasil.com.br`):
1. Compre o domínio em um registrador (Registro.br, GoDaddy, etc.).
2. Na Render: **Settings → Custom Domains → Add**. 
3. Siga as instruções de DNS (registro CNAME). 
4. A Render emite o certificado HTTPS automaticamente.

---

## Troubleshooting (se algo der errado)

| Problema | O que fazer |
|---|---|
| Tela "404" ou erro ao abrir | Veja os **Logs** do serviço. Confirme o **Start Command = `node server.js`**. |
| "Build failed" | O Build Command **deve estar vazio** (não roda `npm install`). |
| Painel de curadoria não entra | Use usuário `editor` + a senha que você pôs em `ADMIN_PASS`. |
| Fica "paused" | É o plano Free. Acesse o link e espere ~10s (spin up) — ou use Starter/VPS. |
| Dados sumiram ao reiniciar | No Free sem volume os dados em `data/` não persistem. Para persistir, adicione um **PostgreSQL** (Render oferece) e defina `DATABASE_URL` — o app já suporta! |

> **Para persistir dados em produção:** a Render oferece **PostgreSQL gratuito**. Crie um (em **New + → PostgreSQL**), copie a `Internal Database URL` e adicione como variável `DATABASE_URL`. O app **já está pronto** para usar Postgres automaticamente quando essa variável existir.

---

## Checklist final

- [ ] Código no GitHub (guia Git)
- [ ] Conta na Render criada (login com GitHub)
- [ ] Web Service conectado ao repositório
- [ ] Start Command = `node server.js`, Build = vazio, Região São Paulo, Free
- [ ] Variáveis: `ADMIN_USER`, `ADMIN_PASS`, `JWT_SECRET` (+ opcionais)
- [ ] Deploy feito, site **Live** e testado
- [ ] (Opcional) Domínio próprio + HTTPS
- [ ] (Para dados persistentes) PostgreSQL + `DATABASE_URL`

> 🎉 **Pronto:** seu app está no ar com um link que não muda. É o "link fixo" — permanente, acessível e sob seu controle.
