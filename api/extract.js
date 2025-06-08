// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import extractPdfText from 'pdf-text-extract';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Configuração da API do Gemini ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("[FATAL] A variável de ambiente GEMINI_API_KEY não está definida!");
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest"});
// --- Fim da Configuração ---

// --- Funções Auxiliares (sem mudanças) ---
async function extractTextFromPdf(filePath) {
    return new Promise((resolve, reject) => {
        extractPdfText(filePath, (err, pages) => {
            if (err) return reject(new Error("Falha ao processar PDF com pdf-text-extract."));
            resolve(pages.join("\n\n"));
        });
    });
}
async function getIntelligentSummaryFromText(text) {
    const truncatedText = text.substring(0, 900000); 
    const prompt = `
      Você é um especialista em análise de textos e resumo. Sua tarefa é ler o texto a seguir e extrair os pontos-chave,
      as ideias principais e as informações mais importantes. O objetivo é criar um resumo conciso e de fácil entendimento
      que capture a essência do documento.

      Instruções:
      1.  **Identifique o Tema Principal:** Comece com um título geral para o documento.
      2.  **Estruture por Tópicos:** Organize o resumo em seções claras usando títulos Markdown (#, ##, ###).
      3.  **Extraia Detalhes Cruciais:** Dentro de cada tópico, extraia dados importantes como nomes, datas, locais, valores, conclusões ou ações necessárias. Use listas com marcadores (*) para maior clareza.
      4.  **SEM PLACEHOLDERS:** Se você encontrar uma seção que contém detalhes muito extensos (como tabelas, longos procedimentos legais, etc.), NÃO use um placeholder como "(detalhado no texto)". Em vez disso, leia a seção e resuma a sua finalidade principal em uma ou duas frases. Por exemplo, para uma seção sobre "Prova de Aptidão Física", escreva algo como: "A prova física avaliará os candidatos em testes de barra fixa, corrida e abdominais. As pontuações variam conforme o desempenho (consulte o documento original para as tabelas de pontuação completas)."
      5.  **SEM TÓPICOS VAZIOS:** NÃO crie um título de seção se você não tem informações para colocar abaixo dele. Se uma seção do texto original não contém informações relevantes para um resumo, simplesmente omita essa seção.
      6.  **Seja Objetivo:** Não adicione opiniões ou informações que não estejam no texto.
      
      Texto para análise:
      ---
      ${truncatedText}
      ---
    `;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
}
// --- Fim das Funções Auxiliares ---


// A Vercel (onde nosso frontend está) precisa que o body seja analisado.
// O Render lida com isso através do middleware no server.js, mas na Vercel, a configuração é por função.
// Como nosso backend agora está no Render, esta configuração não é mais necessária aqui, mas não atrapalha.
export const config = {
    api: {
        bodyParser: true, // Habilitar para aceitar JSON do input de texto
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
    
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "A chave da API do servidor não está configurada."});
    }

    let textToProcess = '';
    let originalFilename = 'texto colado';

    try {
        // Verifica se o request é 'multipart/form-data' (upload de arquivo) ou 'application/json' (texto colado)
        if (req.headers['content-type']?.includes('multipart/form-data')) {
            console.log("[INFO] Recebendo upload de arquivo...");
            const form = formidable({});
            const [fields, files] = await form.parse(req);
            
            if (!files.document || files.document.length === 0) {
                return res.status(400).json({ error: "Nenhum arquivo enviado." });
            }

            const uploadedFile = files.document[0];
            const tempFilePath = uploadedFile.filepath; 
            originalFilename = uploadedFile.originalFilename;
            const mimeType = uploadedFile.mimetype;
            console.log(`[INFO] Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}`);

            if (mimeType === 'application/pdf') {
                textToProcess = await extractTextFromPdf(tempFilePath);
            } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                const result = await mammoth.extractRawText({ path: tempFilePath });
                textToProcess = result.value;
            } else if (mimeType === 'text/plain') {
                textToProcess = await fs.readFile(tempFilePath, 'utf8');
            } else {
                return res.status(400).json({ error: `Formato de arquivo não suportado.` });
            }
            // Deleta o arquivo temporário
            await fs.unlink(tempFilePath).catch(err => console.error("[ERROR] Falha ao deletar arquivo temporário:", err));

        } else if (req.body && req.body.text) {
            console.log("[INFO] Recebendo texto colado...");
            textToProcess = req.body.text;

        } else {
            return res.status(400).json({ error: "Nenhum arquivo ou texto foi enviado." });
        }
        
        if (!textToProcess || !textToProcess.trim()) {
            return res.status(400).json({ error: "O documento ou texto parece estar vazio." });
        }

        // AGORA, CHAMAMOS A IA COM O TEXTO OBTIDO
        const intelligentSummary = await getIntelligentSummaryFromText(textToProcess);

        res.status(200).json({
            message: `Documento "${originalFilename}" analisado pela IA com sucesso!`,
            summary: intelligentSummary
        });

    } catch (error) {
        console.error('[ERROR] Erro geral no handler:', error);
        res.status(500).json({ error: "Erro no servidor ao processar o seu pedido.", details: error.message || String(error) });
    }
}
