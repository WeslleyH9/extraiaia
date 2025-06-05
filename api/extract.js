// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
// Importação legacy para pdfjs-dist v3
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

export const config = {
    api: {
        bodyParser: false,
    },
};

async function extractTextFromPdf(filePath) {
    const dataBuffer = await fs.readFile(filePath);
    const pdfDocument = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;

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

// O RESTANTE DO SEU CÓDIGO 'export default async function handler(req, res) { ... }'
// CONTINUA COMO ESTAVA NA VERSÃO FUNCIONAL ANTERIOR (antes dos diagnósticos complexos)
// Certifique-se de que a lógica do handler que usa formidable e chama extractTextFromPdf está correta.
// Vou colar a parte do handler novamente para garantir:

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const form = formidable({});

    try {
        const [fields, files] = await form.parse(req);

        if (!files.document || files.document.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }

        const uploadedFile = files.document[0];
        const filePath = uploadedFile.filepath; 
        const originalFilename = uploadedFile.originalFilename;
        const mimeType = uploadedFile.mimetype;

        console.log(`Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}`);

        let extractedText = "";

        if (mimeType === 'application/pdf') {
            try {
                extractedText = await extractTextFromPdf(filePath);
                console.log("Texto extraído de PDF usando pdfjs-dist.");
            } catch (pdfError) {
                console.error("Erro ao extrair PDF com pdfjs-dist:", pdfError);
                // Limpar arquivo temporário mesmo em caso de erro de processamento do PDF
                await fs.unlink(filePath).catch(err => console.error("Erro ao deletar arquivo temporário (erro no PDF):", err));
                return res.status(500).json({ error: "Falha ao processar o conteúdo do PDF.", details: pdfError.message });
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') { 
            const result = await mammoth.extractRawText({ path: filePath });
            extractedText = result.value;
            console.log("Texto extraído de DOCX.");
        } else if (mimeType === 'application/msword') { 
            try {
                const result = await mammoth.extractRawText({ path: filePath });
                extractedText = result.value;
                if (!extractedText || !extractedText.trim()) {
                     extractedText = "Não foi possível extrair texto deste arquivo .doc. Tente converter para .docx ou .pdf.";
                }
            } catch (docError) {
                extractedText = "Erro ao processar arquivo .doc. Considere converter para .docx ou .pdf.";
            }
            console.log("Processamento de DOC concluído.");
        } else if (mimeType === 'text/plain') { 
            extractedText = await fs.readFile(filePath, 'utf8');
            console.log("Texto extraído de TXT.");
        } else {
            await fs.unlink(filePath).catch(err => console.error("Erro ao deletar arquivo temporário (tipo não suportado):", err));
            return res.status(400).json({ error: `Formato de arquivo não suportado: ${mimeType}` });
        }

        await fs.unlink(filePath).catch(err => console.error("Erro ao deletar arquivo temporário:", err));

        res.status(200).json({
            message: `Arquivo "${originalFilename}" processado!`,
            extractedTextPreview: extractedText.substring(0, 1000) + (extractedText.length > 1000 ? "..." : ""),
        });

    } catch (error) {
        console.error('Erro geral no processamento do arquivo:', error);
        let userMessage = "Ocorreu um erro no servidor ao processar o arquivo.";
        if (error.message && (error.message.includes("formidable") || error.message.includes("Part"))) {
             userMessage = "Erro no upload do arquivo. Verifique o arquivo e tente novamente.";
        }
        // Se o filePath foi definido, tenta deletar o arquivo temporário mesmo em erro geral.
        if (typeof filePath === 'string' && filePath) {
             await fs.unlink(filePath).catch(err => console.error("Erro ao deletar arquivo temporário (erro geral):", err));
        }
        res.status(500).json({ error: userMessage, details: error.message });
    }
}
