// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises'; // Usamos a versão de 'promises' para async/await
import mammoth from 'mammoth';
// Importa a versão 'legacy' do pdfjs-dist, que é a recomendada para Node.js
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

// ESSENCIAL: Desabilita o worker para evitar erros em ambientes serverless.
// Deve ser feito ANTES de qualquer chamada a pdfjsLib.getDocument.
if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `data:,`; // Define um worker "nulo"
} else {
    // Log de segurança se GlobalWorkerOptions não estiver disponível como esperado
    console.warn("pdfjsLib.GlobalWorkerOptions não está definido. O worker pode não ser desabilitado corretamente.");
}


export const config = {
    api: {
        bodyParser: false, // Necessário para o formidable processar o upload de arquivos
    },
};

// Função auxiliar para extrair texto de PDF
async function extractTextFromPdf(filePath) {
    const dataBuffer = await fs.readFile(filePath);
    // getDocument é uma função do módulo pdfjsLib importado
    const pdfDocument = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;
    
    let fullText = "";
    for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        // Concatena o texto dos itens da página, adicionando um espaço entre eles
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n"; // Adiciona uma nova linha entre as páginas
        page.cleanup(); // Libera recursos da página
    }
    return fullText;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const form = formidable({});
    let tempFilePath; // Variável para guardar o caminho do arquivo temporário

    try {
        const [fields, files] = await form.parse(req);
        
        if (!files.document || files.document.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }

        const uploadedFile = files.document[0];
        tempFilePath = uploadedFile.filepath; // Caminho do arquivo temporário no servidor
        const originalFilename = uploadedFile.originalFilename;
        const mimeType = uploadedFile.mimetype;

        console.log(`[INFO] Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}, Caminho Temp: ${tempFilePath}`);

        let extractedText = "";

        if (mimeType === 'application/pdf') {
            console.log("[INFO] Processando PDF...");
            extractedText = await extractTextFromPdf(tempFilePath);
            console.log("[SUCCESS] Texto extraído de PDF.");
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') { // DOCX
            console.log("[INFO] Processando DOCX...");
            const result = await mammoth.extractRawText({ path: tempFilePath });
            extractedText = result.value;
            console.log("[SUCCESS] Texto extraído de DOCX.");
        } else if (mimeType === 'application/msword') { // DOC
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
        } else if (mimeType === 'text/plain') { // TXT
            console.log("[INFO] Processando TXT...");
            extractedText = await fs.readFile(tempFilePath, 'utf8');
            console.log("[SUCCESS] Texto extraído de TXT.");
        } else {
            console.warn(`[WARN] Formato de arquivo não suportado: ${mimeType}`);
            // Não precisa deletar tempFilePath aqui, o finally cuidará disso.
            return res.status(400).json({ error: `Formato de arquivo não suportado: ${mimeType}` });
        }
        
        // Resposta de sucesso
        res.status(200).json({
            message: `Arquivo "${originalFilename}" processado com sucesso!`,
            // Retorna uma prévia maior para melhor visualização
            extractedTextPreview: extractedText.substring(0, 2000) + (extractedText.length > 2000 ? "..." : ""),
        });

    } catch (error) {
        console.error('[ERROR] Erro geral no processamento do arquivo no handler:', error);
        let userMessage = "Ocorreu um erro no servidor ao processar o arquivo.";
        // Verifica se o erro é do formidable (relacionado ao upload em si)
        if (error.message && (error.message.includes("formidable") || error.message.includes("Part"))) {
             userMessage = "Erro no upload do arquivo. Verifique o arquivo e tente novamente.";
        }
        res.status(500).json({ error: userMessage, details: error.message });
    } finally {
        // Garante que o arquivo temporário seja deletado, mesmo se ocorrerem erros
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
