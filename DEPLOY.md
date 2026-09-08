# Publicar a Checa Fato Brasil em um link fixo (que não cai)

> ⚠️ **Importante:** o **preview** que você vê aqui (endereço `…e2b.app`) é uma prévia **temporária** do ambiente de desenvolvimento — ele **não é um link fixo** e para de existir quando a sessão é encerrada. Para um **link permanente** que fica no ar, é preciso publicar o app numa **plataforma de hospedagem** (os passos abaixo). Este projeto já está pronto para isso (Node puro, sem dependências, com `Dockerfile`).

## Opção A — Render.com (grátis, mais simples) ✔ recomendado
1. Crie uma conta em https://render.com (gratuita).
2. Menu **New → Web Service**.
3. Conecte seu GitHub (ou faça upload do código da pasta `checa-fato-brasil-pro/`).
4. Configure:
   - **Build Command:** `node server.js` (ou deixe vazio — não instala nada)
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
5. **Environment variables** (opcional):
   - `ADMIN_USER=editor`
   - `ADMIN_PASS=umaSenhaForte`
   - `GCC_API_KEY=` (para cruzar com fact-check do Google, se tiver)
6. Deploy. Você recebe uma URL fixa, tipo `https://checa-fato-brasil.onrender.com`.

> O plano Free do Render pausa o serviço após um tempo de inatividade ("spin down") e o reinicia no próximo acesso — fica **fora do ar alguns segundos** ao receber o primeiro visitante. Para uptime contínuo, use o plano **Starter** (pago) ou a **Opção B** (VPS).

## Opção B — VPS / servidor Linux (uptime real, custo mensal)
Se você tem uma instância (AWS, DigitalOcean, Oracle Cloud free tier, etc.):
```bash
# 1) instalar Node 20 e Git
# 2) subir o código
git clone <seu-repo> /opt/checa-fato-brasil
cd /opt/checa-fato-brasil

# 3) rodar como serviço que jamais cai (systemd)
sudo tee /etc/systemd/system/checafato.service >/dev/null <<'EOF'
[Unit]
Description=Checa Fato Brasil
After=network.target
[Service]
WorkingDirectory=/opt/checa-fato-brasil
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Environment=ADMIN_PASS=umaSenhaForte
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now checafato

# 4) (opcional) HTTPS + domínio com Nginx + Certbot
```
Com `Restart=always`, o serviço **reinicia sozinho** se cair — é o "link fixo que não cai".

## Opção C — Container (Docker) em qualquer nuvem
```bash
docker build -t checa-fato-brasil .
docker run -d -p 8080:8080 -v checa-data:/app/data checa-fato-brasil
```
Funciona em Render/Railway/Fly.io/VPS. Use um **volume** para persistir os dados (`-v`).

---

## Mapa: o que precisa de você para publicar
| Item | Status |
|---|---|
| Código pronto para deploy (Node puro + Dockerfile) | ✅ pronto |
| Link fixo público | ⚠️ precisa de uma conta de hospedagem (Render/Railway/VPS) |
| HTTPS / domínio | vem pronto na Render/Railway; na VPS configure Nginx |

> **Resumo:** eu deixei **100% pronto para publicar**. O único passo que depende de você é **criar a conta de hospedagem** (gratuita na Render) e garantir o link. Assim que existir, o app fica no ar de forma permanente e você me pede que eu ajuste/registre o domínio e as variáveis de produção.
