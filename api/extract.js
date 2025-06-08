// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import extractPdfText from 'pdf-text-extract'; // Importa pdf-text-extract

export const config = {
    api: {
        bodyParser: false, // Necessário para o formidable processar o upload
    },
};

// Função auxiliar para extrair texto de PDF usando pdf-text-extract
async function extractTextFromPdfWithPdfTextExtract(filePath) {
    console.log("[INFO] extractTextFromPdfWithPdfTextExtract: Iniciando extração para o arquivo:", filePath);
    return new Promise((resolve, reject) => {
        extractPdfText(filePath, (err, pages) => {
            if (err) {
                console.error("[ERROR] pdf-text-extract: Erro ao extrair texto do PDF:", err);
                let errorMessage = "Falha ao processar PDF com pdf-text-extract.";
                
                // Tenta extrair mais detalhes do erro
                if (typeof err === 'string') {
                    errorMessage += ` Detalhes: ${err}`;
                } else if (err instanceof Error && err.message) {
                    errorMessage += ` Detalhes: ${err.message}`;
                } else if (err.toString) {
                    errorMessage += ` Detalhes: ${err.toString()}`;
                }

                // Verifica se o erro pode ser devido à ausência do 'pdftotext'
                if (errorMessage.toLowerCase().includes('pdftotext') || 
                    (err.message && err.message.toLowerCase().includes('spawn pdftotext enoent'))) {
                    errorMessage += " (Dependência 'pdftotext' pode não estar disponível no ambiente do servidor. Esta biblioteca requer 'pdftotext' instalado no sistema.)";
                    console.error("[ERROR] pdf-text-extract: Comando 'pdftotext' provavelmente ausente.");
                }
                return reject(new Error(errorMessage));
            }
            // 'pages' é um array de strings, onde cada string é o texto de uma página
            const fullText = pages.join("\n\n"); // Usa duas novas linhas para separar melhor o texto das páginas
            console.log("[INFO] pdf-text-extract: Texto extraído com sucesso. Número de páginas processadas:", pages.length);
            resolve(fullText);
        });
    });
}

export default async function extractHandler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const form = formidable({
        keepExtensions: true, // Mantém a extensão do arquivo original no nome temporário, se possível
        maxFileSize: 10 * 1024 * 1024, // Limite de 10MB para o arquivo
    });
    let tempFilePath; 

    try {
        const [fields, files] = await form.parse(req);
        
        if (!files.document || files.document.length === 0) {
            console.warn("[WARN] Handler: Nenhum arquivo 'document' recebido no upload.");
            return res.status(400).json({ error: "Nenhum arquivo enviado com o nome 'document'." });
        }

        const uploadedFile = files.document[0];
        tempFilePath = uploadedFile.filepath; 
        const originalFilename = uploadedFile.originalFilename;
        const mimeType = uploadedFile.mimetype;

        console.log(`[INFO] Handler: Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}, Caminho Temp: ${tempFilePath}`);

        let extractedText = "";

        if (mimeType === 'application/pdf') {
            console.log("[INFO] Handler: Processando PDF com pdf-text-extract...");
            extractedText = await extractTextFromPdfWithPdfTextExtract(tempFilePath);
            console.log("[SUCCESS] Handler: Texto extraído de PDF com pdf-text-extract.");
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') { 
            console.log("[INFO] Handler: Processando DOCX...");
            const result = await mammoth.extractRawText({ path: tempFilePath });
            extractedText = result.value;
            console.log("[SUCCESS] Handler: Texto extraído de DOCX.");
        } else if (mimeType === 'application/msword') { 
            // O suporte a .doc legado pelo mammoth é limitado e pode não funcionar para todos os arquivos .doc
            console.log("[INFO] Handler: Tentando processar DOC com Mammoth...");
            try {
                const result = await mammoth.extractRawText({ path: tempFilePath });
                extractedText = result.value;
                if (!extractedText || !extractedText.trim()) {
                     extractedText = "Não foi possível extrair texto deste arquivo .doc. Tente converter para .docx ou .pdf.";
                     console.warn("[WARN] Handler: DOC processado com Mammoth, mas texto vazio.");
                } else { 
                    console.log("[SUCCESS] Handler: Texto extraído de DOC com Mammoth.");
                }
            } catch (docError) {
                console.error("[ERROR] Handler: Erro ao ler .doc com Mammoth:", docError);
                extractedText = "Erro ao processar arquivo .doc. Pode ser um formato antigo ou corrompido.";
            }
        } else if (mimeType === 'text/plain') { 
            console.log("[INFO] Handler: Processando TXT...");
            extractedText = await fs.readFile(tempFilePath, 'utf8');
            console.log("[SUCCESS] Handler: Texto extraído de TXT.");
        } else {
            console.warn(`[WARN] Handler: Formato de arquivo não suportado: ${mimeType}`);
            return res.status(400).json({ error: `Formato de arquivo não suportado: ${mimeType}` });
        }
        
        res.status(200).json({
            message: `Arquivo "${originalFilename}" processado com sucesso!`,
            extractedTextPreview: extractedText.substring(0, 2000) + (extractedText.length > 2000 ? "..." : ""),
        });

    } catch (error) {
        console.error('[ERROR] Handler: Erro geral no processamento do arquivo:', error);
        let userMessage = "Ocorreu um erro no servidor ao processar o arquivo.";
        if (error.message && (error.message.includes("formidable") || error.message.includes("Part") || error.message.includes("maxFileSize"))) {
             userMessage = "Erro no upload do arquivo. Verifique o tamanho ou o formato do arquivo e tente novamente.";
        } else if (error.message && error.message.includes("pdf-text-extract")) {
            userMessage = "Erro ao processar o conteúdo do PDF. O arquivo pode estar corrompido ou em um formato PDF não suportado.";
        }
        res.status(500).json({ error: userMessage, details: error.message || String(error) });
    } finally {
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
                console.log(`[INFO] Handler: Arquivo temporário ${tempFilePath} deletado.`);
            } catch (unlinkError) {
                console.error("[ERROR] Handler: Falha ao deletar arquivo temporário no finally:", unlinkError);
            }
        }
    }
}
