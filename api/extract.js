// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
// Importa o módulo legacy do pdfjs-dist
import * as pdfjsStar from 'pdfjs-dist/legacy/build/pdf.js';

// --- Bloco de Diagnóstico e Configuração do PDF.js ---
let getDocumentFunction;
let pdfjsConfigError = null;

// Primeiro, vamos ver o que é o 'pdfjsStar' e 'pdfjsStar.default'
console.log("[DEBUG] pdfjsStar (importação direta * as):", typeof pdfjsStar, Object.keys(pdfjsStar || {}));
if (pdfjsStar && typeof pdfjsStar.default !== 'undefined') {
    console.log("[DEBUG] pdfjsStar.default:", typeof pdfjsStar.default, Object.keys(pdfjsStar.default || {}));
}

// Tentativa de acessar o objeto principal da biblioteca PDF.js
const pdfjsLib = pdfjsStar.default || pdfjsStar; // Tenta o .default primeiro

// REMOVEMOS A CONFIGURAÇÃO DE GlobalWorkerOptions.workerSrc
// A build legacy deve funcionar em Node.js sem essa configuração explícita.
// Se ela ainda tentar carregar um worker e falhar, o problema é mais profundo.
console.log("[INFO] pdfjs-dist: Não estamos configurando GlobalWorkerOptions.workerSrc explicitamente.");


// Verifica se a função getDocument está acessível
if (pdfjsLib && typeof pdfjsLib.getDocument === 'function') {
    getDocumentFunction = pdfjsLib.getDocument;
    console.log("[INFO] pdfjs-dist: getDocument carregado com sucesso.");
} else {
    const msg = "[ERROR] Falha crítica: pdfjsLib.getDocument não é uma função válida.";
    console.error(msg);
    pdfjsConfigError = msg; // Guarda o erro mais relevante
}
// --- Fim do Bloco de Diagnóstico ---

export const config = {
    api: {
        bodyParser: false,
    },
};

async function extractTextFromPdf(filePath) {
    if (typeof getDocumentFunction !== 'function') {
        throw new Error(pdfjsConfigError || 'Função getDocument do pdfjs-dist não está disponível.');
    }
    const dataBuffer = await fs.readFile(filePath);
    const pdfDocument = await getDocumentFunction({ data: new Uint8Array(dataBuffer) }).promise;
    let fullText = "";
    for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n";
        page.cleanup();
    }
    return fullText;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    if (pdfjsConfigError && typeof getDocumentFunction !== 'function') {
        console.error("[ERROR] Handler iniciado, mas configuração do PDF.js falhou:", pdfjsConfigError);
        return res.status(500).json({ error: "Dependência crítica para PDF não carregada/configurada.", details: pdfjsConfigError });
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
        console.log(`[INFO] Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}, Caminho Temp: ${tempFilePath}`);
        let extractedText = "";
        if (mimeType === 'application/pdf') {
            console.log("[INFO] Processando PDF...");
            extractedText = await extractTextFromPdf(tempFilePath);
            console.log("[SUCCESS] Texto extraído de PDF.");
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            console.log("[INFO] Processando DOCX...");
            const result = await mammoth.extractRawText({ path: tempFilePath });
            extractedText = result.value;
            console.log("[SUCCESS] Texto extraído de DOCX.");
        } else if (mimeType === 'application/msword') {
            console.log("[INFO] Tentando processar DOC com Mammoth...");
            try {
                const result = await mammoth.extractRawText({ path: tempFilePath });
                extractedText = result.value;
                if (!extractedText || !extractedText.trim()) {
                     extractedText = "Não foi possível extrair texto deste arquivo .doc. Tente converter para .docx ou .pdf.";
                     console.warn("[WARN] DOC processado com Mammoth, mas texto vazio.");
                } else { console.log("[SUCCESS] Texto extraído de DOC com Mammoth."); }
            } catch (docError) {
                console.error("[ERROR] Erro ao ler .doc com Mammoth:", docError);
                extractedText = "Erro ao processar arquivo .doc.";
            }
        } else if (mimeType === 'text/plain') {
            console.log("[INFO] Processando TXT...");
            extractedText = await fs.readFile(tempFilePath, 'utf8');
            console.log("[SUCCESS] Texto extraído de TXT.");
        } else {
            console.warn(`[WARN] Formato de arquivo não suportado: ${mimeType}`);
            return res.status(400).json({ error: `Formato de arquivo não suportado: ${mimeType}` });
        }
        res.status(200).json({
            message: `Arquivo "${originalFilename}" processado com sucesso!`,
            extractedTextPreview: extractedText.substring(0, 2000) + (extractedText.length > 2000 ? "..." : ""),
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
