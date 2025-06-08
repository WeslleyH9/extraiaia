// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import extractPdfText from 'pdf-text-extract';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Configuração da API do Gemini ---
// Pega a chave da API das variáveis de ambiente do Render.com
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
                return reject(new Error("Falha ao processar PDF."));
            }
            resolve(pages.join("\n\n"));
        });
    });
}

// Função que chama o Gemini para extrair dados estruturados
async function getStructuredDataFromText(text) {
    // Truncar o texto para não exceder os limites da API
    const truncatedText = text.substring(0, 900000); // Limite generoso
    
    // O prompt que instrui a IA sobre o que fazer
    const prompt = `
      Você é um especialista em analisar documentos como editais de concurso, vestibulares e currículos.
      Analise o texto a seguir e extraia as informações mais importantes.
      Responda APENAS com um objeto JSON. Não inclua texto antes ou depois do JSON.
      Se uma informação não for encontrada, retorne null para o seu valor.

      O formato do JSON deve ser:
      {
        "nomeConcursoOuVaga": "string ou null",
        "instituicaoOrganizadora": "string ou null",
        "principaisCargos": ["string"],
        "salarioBase": "string ou null",
        "beneficios": ["string"],
        "escolaridadeExigida": "string ou null",
        "periodoInscricao": { "inicio": "string ou null", "fim": "string ou null" },
        "valorInscricao": "string ou null",
        "dataProva": "string ou null",
        "principaisEtapas": ["string"]
      }
      
      Texto para análise:
      ---
      ${truncatedText}
      ---
    `;

    console.log("[INFO] Chamando API do Gemini...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonText = response.text();
    console.log("[INFO] Resposta bruta do Gemini recebida.");

    // Tenta limpar e analisar a resposta JSON
    try {
        // Remove possíveis acentos graves ou marcadores de código do início e fim
        const cleanedJsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        const structuredData = JSON.parse(cleanedJsonText);
        console.log("[SUCCESS] Resposta do Gemini analisada como JSON.");
        return structuredData;
    } catch (e) {
        console.error("[ERROR] Falha ao analisar a resposta JSON do Gemini.", e);
        console.error("[DEBUG] Resposta bruta que falhou:", jsonText);
        throw new Error("A IA retornou uma resposta em um formato inválido.");
    }
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

        // AGORA, CHAMAMOS A IA COM O TEXTO EXTRAÍDO
        const structuredData = await getStructuredDataFromText(extractedText);

        res.status(200).json({
            message: `Arquivo "${originalFilename}" analisado pela IA com sucesso!`,
            structuredData: structuredData // Enviamos os dados estruturados para o frontend
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
