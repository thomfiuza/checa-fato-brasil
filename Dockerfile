# Checa Fato Brasil — imagem de produção
# Compila um container leve que sobe o app com porta fixa.
# Build:   docker build -t checa-fato-brasil .
# Run:     docker run -p 8080:8080 checa-fato-brasil
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
# instala dependências (pg) antes de copiar o resto (cache de camadas)
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
# garante que o diretório de dados exista e seja persistível via volume
VOLUME ["/app/data"]
CMD ["node", "server.js"]
