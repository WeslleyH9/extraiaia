// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';

// Tentativa de importar getDocument e GlobalWorkerOptions diretamente da build legacy
// Esta é uma abordagem comum para bibliotecas UMD/CommonJS em ambientes ES Module com Node.js
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.js';

// ESSENCIAL: Desabilita o worker para evitar erros em ambientes serverless.
// Deve ser feito ANTES de qualquer chamada a getDocument.
if (GlobalWorkerOptions) {
    GlobalWorkerOptions.workerSrc = false; // Define como false para desabilitar explicitamente o worker.
    console.log("[INFO] pdfjs-dist: GlobalWorkerOptions.workerSrc configurado como false.");
} else {
    // Isso não deveria acontecer se a importação acima funcionar.
    console.warn("[WARN] pdfjs-dist: GlobalWorkerOptions não foi encontrado a partir da importação nomeada. O worker pode não ser desabilitado corretamente.");
}

export const config = {
    api: {
        bodyParser: false, // Necessário para o formidable processar o upload
    },
};

// Função auxiliar para extrair texto de PDF
async function extractTextFromPdf(filePath) {
    // Verifica se getDocument foi importado corretamente e é uma função
    if (typeof getDocument !== 'function') {
        const errorMsg = "[ERROR] Falha crítica: getDocument não é uma função válida. Verifique a importação de 'pdfjs-dist/legacy/build/pdf.js'.";
        console.error(errorMsg);
        throw new Error('Biblioteca PDF não carregou corretamente ou getDocument não é uma função.');
    }

    const dataBuffer = await fs.readFile(filePath);
    const pdfDocument = await getDocument({ data: new Uint8Array(dataBuffer) }).promise;
    
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

    // Verifica se getDocument foi carregado corretamente no início do handler
    if (typeof getDocument !== 'function') {
        console.error("[ERROR] Handler iniciado, mas getDocument não está disponível. A importação de pdfjs-dist falhou.");
        return res.status(500).json({ error: "Dependência crítica para PDF (getDocument) não carregada no servidor."});
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
                     extractedText = "Não foi possível extrair texto deste arquivo .doc. Tente converter para .docx ou .pdf e tente novamente.";
                     console.warn("[WARN] DOC processado com Mammoth, mas texto vazio.");
                } else {
                    console.log("[SUCCESS] Texto extraído de DOC com Mammoth.");
                }
            } catch (docError) {
                console.error("[ERROR] Erro ao ler .doc com Mammoth:", docError);
                extractedText = "Erro ao processar arquivo .doc. Pode ser um formato antigo ou corrompido. Considere converter para .docx ou .pdf.";
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
        console.error('[ERROR] Erro geral no processamento do arquivo no handler:', error);
        let userMessage = "Ocorreu um erro no servidor ao processar o arquivo.";
        if (error.message && (error.message.includes("formidable") || error.message.includes("Part"))) {
             userMessage = "Erro no upload do arquivo. Verifique o arquivo e tente novamente.";
        }
        res.status(500).json({ error: userMessage, details: error.message || String(error) });
    } finally {
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
                console.log(`[INFO] Arquivo temporário ${tempFilePath} deletado.`);
            } catch (unlinkError) {
                console.error("[ERROR] Falha ao deletar arquivo temporário no finally:", unlinkError);
            }
        }
    }
}
