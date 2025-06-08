# Usa uma imagem oficial do Node.js como base. Escolhemos a versão 20 (LTS estável).
FROM node:20-slim

# Define o diretório de trabalho dentro do contêiner
WORKDIR /usr/src/app

# ATUALIZA A LISTA DE PACOTES E INSTALA A DEPENDÊNCIA DE SISTEMA 'poppler-utils'
# 'poppler-utils' contém a ferramenta 'pdftotext', que a biblioteca 'pdf-text-extract' usa.
# O '--no-install-recommends' ajuda a manter a imagem pequena.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*

# Copia o package.json (e package-lock.json, se existir) para o diretório de trabalho
COPY package*.json ./

# Instala as dependências do Node.js listadas no package.json
RUN npm install --omit=dev

# Copia o restante dos arquivos do seu projeto (a pasta 'api', server.js, etc.) para o diretório de trabalho
COPY . .

# Expõe a porta que o nosso servidor vai usar (o Render define a variável PORT)
EXPOSE ${PORT:-10000}

# Comando para iniciar o servidor web
CMD [ "node", "server.js" ]
