// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
// Importa o módulo legacy do pdfjs-dist
import pdfjsLegacyModule from 'pdfjs-dist/legacy/build/pdf.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = `data:,`;

export const config = {
    api: {
        bodyParser: false, // Necessário para o formidable processar o upload
    },
};

// Função auxiliar para extrair texto de PDF usando pdfjs-dist
async function extractTextFromPdf(filePath) {
    // Tenta aceder a getDocument através do 'default' export (comum para módulos CJS/UMD importados em ESM)
    // ou diretamente se a exportação principal já for o objeto esperado.
    const getDocument = pdfjsLegacyModule.getDocument || 
                        (pdfjsLegacyModule.default ? pdfjsLegacyModule.default.getDocument : undefined);

    if (typeof getDocument !== 'function') {
        console.error('Falha crítica: pdfjsLegacyModule.getDocument ou pdfjsLegacyModule.default.getDocument não é uma função.');
        console.error('Conteúdo de pdfjsLegacyModule:', JSON.stringify(pdfjsLegacyModule, null, 2));
        if (pdfjsLegacyModule && typeof pdfjsLegacyModule.default !== 'undefined') {
            console.error('Conteúdo de pdfjsLegacyModule.default:', JSON.stringify(pdfjsLegacyModule.default, null, 2));
        }
        throw new Error('Biblioteca PDF não carregou corretamente (getDocument não encontrado).');
    }

    const dataBuffer = await fs.readFile(filePath);
    const pdfDocument = await getDocument({ data: new Uint8Array(dataBuffer) }).promise;
    
    let fullText = "";
    for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n"; // Adiciona uma nova linha entre as páginas
        page.cleanup(); 
    }
    return fullText;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const form = formidable({});
    let filePath; // Definir filePath aqui para que esteja acessível no bloco finally

    try {
        const [fields, files] = await form.parse(req);
        
        if (!files.document || files.document.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }

        const uploadedFile = files.document[0];
        filePath = uploadedFile.filepath; // Atribuir a filePath
        const originalFilename = uploadedFile.originalFilename;
        const mimeType = uploadedFile.mimetype;

        console.log(`Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}`);

        let extractedText = "";

        if (mimeType === 'application/pdf') {
            try {
                extractedText = await extractTextFromPdf(filePath);
                console.log("Texto extraído de PDF usando pdfjs-dist (legacy).");
            } catch (pdfError) {
                console.error("Erro ao extrair PDF com pdfjs-dist:", pdfError);
                // Não precisa deletar filePath aqui, o finally cuidará disso.
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
                console.error("Erro ao ler .doc com Mammoth:", docError)
                extractedText = "Erro ao processar arquivo .doc. Considere converter para .docx ou .pdf.";
            }
            console.log("Processamento de DOC concluído.");
        } else if (mimeType === 'text/plain') { 
            extractedText = await fs.readFile(filePath, 'utf8');
            console.log("Texto extraído de TXT.");
        } else {
            // Não precisa deletar filePath aqui, o finally cuidará disso se filePath estiver definido.
            return res.status(400).json({ error: `Formato de arquivo não suportado: ${mimeType}` });
        }
        
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
        res.status(500).json({ error: userMessage, details: error.message });
    } finally {
        // Limpar o arquivo temporário após o uso, se filePath foi definido
        if (filePath) {
            try {
                await fs.unlink(filePath);
                console.log(`Arquivo temporário ${filePath} deletado.`);
            } catch (unlinkError) {
                console.error("Erro ao deletar arquivo temporário no finally:", unlinkError);
            }
        }
    }
}
