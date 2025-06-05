// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import pdf from 'pdf-parse'; // Importa o pdf-parse

export const config = {
    api: {
        bodyParser: false, // Necessário para o formidable processar o upload
    },
};

// Função auxiliar para extrair texto de PDF usando pdf-parse
async function extractTextFromPdfWithPdfParse(filePath) {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdf(dataBuffer); // pdf-parse retorna um objeto com a propriedade 'text'
    console.log("[INFO] pdf-parse: Metadados do PDF:", data.info);
    console.log("[INFO] pdf-parse: Número de páginas:", data.numpages);
    return data.text; // Retorna o texto extraído
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
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
            console.log("[INFO] Processando PDF com pdf-parse...");
            try {
                extractedText = await extractTextFromPdfWithPdfParse(tempFilePath);
                console.log("[SUCCESS] Texto extraído de PDF com pdf-parse.");
            } catch (pdfError) {
                console.error("[ERROR] Erro ao extrair PDF com pdf-parse:", pdfError);
                return res.status(500).json({ error: "Falha ao processar o conteúdo do PDF com pdf-parse.", details: pdfError.message });
            }
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
