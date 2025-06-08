// server.js
import express from 'express';
import cors from 'cors'; // Importa o pacote CORS
import extractHandler from './api/extract.js'; // Importa nossa função de extração

const app = express();
const port = process.env.PORT || 10000; // O Render define a porta através de uma variável de ambiente

// Habilita o CORS para permitir que nosso site na Vercel chame este backend
app.use(cors());

// Define uma rota /api/extract que aceita requisições POST
app.post('/api/extract', (req, res) => {
  // Chama a nossa função de extração original, passando os objetos req e res
  extractHandler(req, res);
});

// Rota de "saúde" para verificar se o servidor está no ar
app.get('/', (req, res) => {
    res.status(200).send('Servidor do Extraia.ai no ar!');
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});