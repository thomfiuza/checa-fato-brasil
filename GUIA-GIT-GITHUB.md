# 🛡️ Guia Completo — Versionar e Proteger sua Propriedade no Git/GitHub

> **Objetivo:** guardar o código da **Checa Fato Brasil** de forma organizada, com histórico, e protegê-lo como **sua propriedade intelectual** — mantendo a possibilidade de ser público (e auditável), mas **íntegro, verdadeiro e sob seu controle**. Você não precisa ser programador para seguir; cada passo é explicado.

---

## Antes de começar — o que é Git e por que ele protege você

- **Git** é o sistema que registra **cada versão** do seu código num histórico. Se algo quebrar, você volta. Se alguém mexer, você vê **quem, quando e o quê**. É a "ata" exata do seu projeto.
- **GitHub** é onde você guarda essa cópia **na nuvem** (backup automático + acesso de qualquer lugar).
- **Atenção à sua propriedade:** TODO o código é seu. Use uma **licença clara** para dizer como o mundo pode usá-lo (mais sobre isso abaixo). O fato de ser público **não** entrega a autoria a ninguém — a autoria e o copyright continuam seus, e a licença é quem regula o uso alheio.

---

## Parte 1 — Instalar as ferramentas (uma vez só)

### 1.1 Instalar o Git
- **Windows:** baixe em https://git-scm.com/downloads e instale (aceite os padrões; marque "Git Bash here").
- **Mac:** abra o Terminal e digite `brew install git` (ou baixe o instalador).
- **Linux:** `sudo apt install git`.

Confirme: feche e abra um terminal, digite `git --version`. Deve aparecer algo como `git version 2.xx`.

### 1.2 Criar uma conta no GitHub
- Acesse https://github.com e clique em **Sign up**. Crie seu usuário e e-mail confirmado.
- Você terá um endereço como `https://github.com/SEU-USUARIO`.

---

## Parte 2 — Preparar o projeto (o arquivo `.gitignore`)

Antes de subir, é importante **não subir dados sensíveis** (senha, token). Crie o arquivo `.gitignore` na raiz do projeto. **Já deixei pronto para você —** basta conferir:

```bash
# Na pasta checa-fato-brasil-pro, crie o arquivo .gitignore com o conteúdo abaixo:
node_modules
data
*.log
.env
.git
.DS_Store
```
> Isso impede que o `data/` (seus registros) e qualquer `.env` (com senha/token) sejam enviados ao repositório. É a primeira camada de proteção.

---

## Parte 3 — Subir o projeto no GitHub (passo a passo didático)

> Você tem duas rotas. Esolha a mais confortável.

### Rota A — Via GitHub Desktop (sem comandos, mais fácil)
1. Baixe e instale o **GitHub Desktop**: https://desktop.github.com
2. Entre com sua conta GitHub.
3. **File → New repository** → Nome: `checa-fato-brasil` → escolha a pasta local → **Create repository**.
4. Agora o GitHub Desktop mostra seus arquivos no painel esquerdo. Marque todos → escreva uma mensagem no campo (ex.: `Primeira versão`) → **Commit**.
5. **Publish repository** (botão no topo) → marque "Keep this code private" se quiser privado, ou deixe público → **Publish**.
6. Pronto! Seu código está no GitHub. Daqui em diante, sempre que editar, faça **Commit** e **Push** (botões no GitHub Desktop).

### Rota B — Via terminal (mais controle)
Abra o terminal na pasta do projeto e digite, na ordem:

```bash
cd checa-fato-brasil-pro        # entra na pasta do projeto

git init                        # cria o histórico de versões
git config --global user.name  "Seu Nome"
git config --global user.email "seuemail@exemplo.com"

git add .                       # "adiciona" todos os arquivos para a versão
git commit -m "Versão inicial da Checa Fato Brasil"   # grava esta versão

# cria o repositório no GitHub (uma vez):
git remote add origin https://github.com/SEU-USUARIO/checa-fato-brasil.git
git branch -M main
git push -u origin main         # envia tudo para o GitHub
```

> No GitHub, crie antes o repositório vazio (botão **New repository**). Substitua `SEU-USUARIO` pelo seu.

---

## Parte 4 — a cada alteração (rotina de segurança)

Sempre que você mudar o código, proteja a nova versão:
```bash
git add .
git commit -m "Descrição do que mudou (ex.: corrigi busca da Wikipedia)"
git push
```
> Esse hábito é o que dá o **histórico completo** (nada se perde) e demonstra a **integridade** do projeto.

---

## Parte 5 — Como declarar que é SUA propriedade e o que o mundo pode fazer (licença)

O que você precisa decidir é a **licença** (o "quem pode usar como").

| Licença | O que permite | Uso sugerido |
|---|---|---|
| **MIT** | Usar, modificar e redistribuir, mantendo seu aviso de copyright | Código aberto livre (muito comum) |
| **GPL-3.0** | Usar e modificar, **mas** quem distribuir deve abrir o código também | Se quiser forçar abertura |
| **CC-BY-SA-4.0** | Compartilhar e adaptar, com **atribuição** e mesmas condições | **Conteúdo/dados** (a API pública já usa esta) |
| Proprietária / "Todos os direitos reservados" | Ninguém pode usar sem sua permissão | Se preferir fechar |

**Recomendação para o seu caso:** como o projeto é **público e voltado ao interesse público**, mas você quer que ele seja **verdadeiro e íntegro**, o mais coerente é:
- **Código:** licença **GPL-3.0** ou **MIT**.
- **Conteúdo/dados verificados:** **CC-BY-SA-4.0** (atribuição obrigatória + mesmas condições) — que já está na API pública.

### Como aplicar a licença no repositório
1. Crie um arquivo `LICENSE` na raiz do projeto com o texto da licença escolhida (o GitHub gera: repositório → **Add file → Create new file → LICENSE** → escolha a licença).
2. Adicione um arquivo `COPYRIGHT` ou mantenha o seu nome no cabeçalho do código.

> ⚠️ **Conteúdo que você NÃO pode licenciar como seu:** dados de terceiros citados como fonte (dados de gov.br, Wikipedia, Câmara) têm licença própria — você os **cita** (atribuição), não os torna seus. É aí que nasce a **integridade** do projeto: você **atribui corretamente** toda fonte.

---

## Parte 6 — Proteger credenciais e senhas (essencial)

NUNCA suba para o GitHub: senha do painel `ADMIN_PASS`, chave `GCC_API_KEY`, `JWT_SECRET` e `DATABASE_URL`. São **segredos de produção**.

- Crie um arquivo `.env` **local** (na sua máquina) com esses valores — ele está no `.gitignore`, então **não** vai para o GitHub.
- O repositório carrega apenas um **`.env.example`** (com placeholders), que é seguro.

```bash
# .env (local, NUNCA no GitHub)
ADMIN_USER=editor
ADMIN_PASS=UmaSenhaMUITOForte
JWT_SECRET=um-texto-aleatorio-longo
# GCC_API_KEY=...
```

> Em produção (Render/VPS), esses valores entram no painel de variáveis de ambiente da plataforma, **não** no código.

---

## Parte 7 — Como garantir integridade e verdade (revisão de terceiros)

Se o projeto é público e pretende ser confiável, vale:
1. **README** claro com: o que é, como funciona, fontes usadas, metodologia, limitações e licença. *(Já deixei um README montado — é só revisar.)*
2. **CHANGELOG**: registro das mudanças (mostra evolução e transparência).
3. **Código aberto = auditável**: qualquer pessoa pode ver a lógica; isso **aumenta** a confiança, não a diminui — desde que você **atribua as fontes** corretamente.
4. **Releases/tags**: quando ficar pronto para um marco (ex.: v1.0), crie uma **tag** no GitHub para congelar aquela versão (prova de integridade).

---

## Checklist final (marque conforme fizer)

- [ ] Git instalado (`git --version`)
- [ ] Conta no GitHub criada
- [ ] `.gitignore` configurado (exclui `data/`, `.env`, `node_modules`)
- [ ] Código commitado e enviado (`git push`)
- [ ] Arquivo `LICENSE` escolhido e adicionado
- [ ] README revisado
- [ ] Segredos **somente** no `.env` local / variáveis da platforma (nunca no repositório)
- [ ] (Opcional) CHANGELOG + tags/releases

---

> 💡 **Resumo da proteção:** Git = histórico + rastreabilidade. GitHub = backup + acesso. `.gitignore` = não vaza segredo. **Licença** = deixa claro que a propriedade é sua e como podem usar. **Atribuição de fontes** = garante a **verdade/integridade**. Com isso, seu projeto é público E seu, íntegro E auditável.
