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


export const config = {
    api: {
        bodyParser: false,
    },
};

// Função para extrair texto de PDF
async function extractTextFromPdf(filePath) {
    return new Promise((resolve, reject) => {
        extractPdfText(filePath, (err, pages) => {
            if (err) {
                console.error("[ERROR] pdf-text-extract:", err);
                return reject(new Error("Falha ao processar PDF com pdf-text-extract."));
            }
            resolve(pages.join("\n\n"));
        });
    });
}

// Função que chama o Gemini para criar um resumo inteligente
async function getIntelligentSummaryFromText(text) {
    const truncatedText = text.substring(0, 900000); 
    
    // NOVO PROMPT GENÉRICO
    const prompt = `
      Você é um especialista em análise de textos e resumo. Sua tarefa é ler o texto a seguir e extrair os pontos-chave,
      as ideias principais e as informações mais importantes. O objetivo é criar um resumo conciso e de fácil entendimento
      que capture a essência do documento.

      Instruções:
      - Identifique o tema principal e os subtemas.
      - Extraia dados cruciais como nomes, datas, locais, valores, conclusões ou ações necessárias.
      - Apresente o resultado usando formatação Markdown para clareza (títulos, listas com marcadores, negrito).
      - Seja objetivo. Não adicione opiniões ou informações que não estejam no texto.
      
      Texto para análise:
      ---
      ${truncatedText}
      ---
    `;

    console.log("[INFO] Chamando API do Gemini para resumo inteligente...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summaryText = response.text();
    console.log("[SUCCESS] Resumo do Gemini recebido.");

    return summaryText;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }
    
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "A chave da API do servidor não está configurada."});
    }

    const form = formidable({});
    let tempFilePath; 

    try {
        const [fields, files] = await form.parse(req);
        if (!files.document || files.document.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }
        const uploadedFile = files.document[0];
        tempFilePath = uploadedFile.filepath; 
        const originalFilename = uploadedFile.originalFilename;
        const mimeType = uploadedFile.mimetype;
        console.log(`[INFO] Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}`);

        let extractedText = "";

        if (mimeType === 'application/pdf') {
            extractedText = await extractTextFromPdf(tempFilePath);
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ path: tempFilePath });
            extractedText = result.value;
        } else if (mimeType === 'text/plain') {
            extractedText = await fs.readFile(tempFilePath, 'utf8');
        } else {
            return res.status(400).json({ error: `Formato de arquivo não suportado.` });
        }
        
        if (!extractedText || !extractedText.trim()) {
            return res.status(400).json({ error: "Não foi possível extrair texto do documento." });
        }

        // AGORA, CHAMAMOS A IA COM O NOVO PROMPT
        const intelligentSummary = await getIntelligentSummaryFromText(extractedText);

        res.status(200).json({
            message: `Arquivo "${originalFilename}" analisado pela IA com sucesso!`,
            summary: intelligentSummary // Enviamos o resumo em texto/Markdown para o frontend
        });

    } catch (error) {
        console.error('[ERROR] Erro geral no handler:', error);
        res.status(500).json({ error: "Erro no servidor ao processar arquivo.", details: error.message || String(error) });
    } finally {
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
                console.log(`[INFO] Arquivo temporário ${tempFilePath} deletado.`);
            } catch (unlinkError) {
                console.error("[ERROR] Falha ao deletar arquivo temporário:", unlinkError);
            }
        }
    }
}
