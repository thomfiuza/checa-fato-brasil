#!/usr/bin/env bash
# =====================================================================
# Checa Fato Brasil — Deploy em VPS (Ubuntu/Debian) com systemd
# Resultado: serviço 24/7 com Restart=always (não cai).
#
# Uso:
#   1. Na VPS, instale Node.js >= 18 (ex.: via NodeSource ou nvm).
#   2. Faça clone do repositório para /opt/checa-fato-brasil:
#        sudo git clone https://github.com/thomfiuza/checa-fato-brasil.git /opt/checa-fato-brasil
#   3. Crie o arquivo de ambiente com os valores reais (NUNCA no repo):
#        sudo cp .env.production.example /etc/checafato.env
#        sudo nano /etc/checafato.env   # preencha
#        sudo chmod 600 /etc/checafato.env
#   4. Rode este script:
#        sudo bash deploy-vps.sh
# =====================================================================
set -euo pipefail

APP_NAME="checa-fato-brasil"
APP_DIR="/opt/${APP_NAME}"
ENV_FILE="/etc/${APP_NAME}.env"
LOG_FILE="/var/log/${APP_NAME}.log"

# --- validações ---
if [[ $EUID -ne 0 ]]; then
  echo "ERRO: rode como root (sudo bash deploy-vps.sh)"; exit 1
fi
if [[ ! -d "$APP_DIR/.git" && ! -f "$APP_DIR/server.js" ]]; then
  echo "ERRO: projeto não encontrado em $APP_DIR. Faça o git clone primeiro."; exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: $ENV_FILE não existe.";
  echo "Copie o modelo: sudo cp $APP_DIR/.env.production.example $ENV_FILE";
  echo "Preencha e proteja: sudo chmod 600 $ENV_FILE"; exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: Node.js não encontrado. Instale Node >= 18."; exit 1
fi
NODE_VER=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_VER" -lt 18 ]]; then
  echo "ERRO: Node >= 18 necessário (atual: $(node -v))."; exit 1
fi

# --- usuário dedicado (sem root) ---
if ! id "checafato" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin checafato
  chown -R checafato:checafato "$APP_DIR"
fi
# pasta de dados persistente, fora do repositório (sobrevive a git pull)
mkdir -p /var/lib/checafato
chown -R checafato:checafato /var/lib/checafato

# --- unidade systemd (Restart=always) ---
cat > /etc/systemd/system/${APP_NAME}.service <<EOF
[Unit]
Description=Checa Fato Brasil — plataforma de verificação (API + app)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=checafato
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
# Pasta de dados persistente (fora do repo)
Environment=DATA_DIR=/var/lib/checafato
ExecStart=$(command -v node) ${APP_DIR}/server.js
Restart=always
RestartSec=5
# Hardening básico
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/checafato

[Install]
WantedBy=multi-user.target
EOF

# --- ativar ---
systemctl daemon-reload
systemctl enable ${APP_NAME}.service
systemctl restart ${APP_NAME}.service

sleep 2
echo "======================================================"
if systemctl is-active --quiet ${APP_NAME}.service; then
  echo "✅ ${APP_NAME} está rodando (24/7, Restart=always)."
  echo "   Logs:   journalctl -u ${APP_NAME} -f"
  echo "   Teste:  curl http://localhost:8080/api/health"
  echo "   Abrir:  http://SEU_IP_DA_VPS:8080"
else
  echo "❌ Falhou ao iniciar. Veja os logs:"
  journalctl -u ${APP_NAME}.service -n 30 --no-pager
  exit 1
fi
