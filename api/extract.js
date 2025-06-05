// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises'; // Usamos a versão de 'promises' para async/await
import mammoth from 'mammoth';
// Importa a versão 'legacy' do pdfjs-dist, que é a recomendada para Node.js
import * as pdfjsStar from 'pdfjs-dist/legacy/build/pdf.js';
const pdfjsLib = pdfjsStar.default || pdfjsStar;
// ESSENCIAL: Desabilita o worker para evitar erros em ambientes serverless.
// Deve ser feito ANTES de qualquer chamada a pdfjsLib.getDocument.
if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `data:,`; // Define um worker "nulo"
} else {
    console.warn("[WARN] pdfjs-dist: pdfjsLib OU pdfjsLib.GlobalWorkerOptions não está definido após tentar .default. O worker pode não ser desabilitado.");
    // Logs de diagnóstico para entender a estrutura do que foi importado
    console.log("[DEBUG] Conteúdo de pdfjsStar (importação original):", typeof pdfjsStar === 'object' ? Object.keys(pdfjsStar) : pdfjsStar);
    if (pdfjsStar && typeof pdfjsStar.default !== 'undefined') {
        console.log("[DEBUG] Conteúdo de pdfjsStar.default:", typeof pdfjsStar.default === 'object' ? Object.keys(pdfjsStar.default) : pdfjsStar.default);
    }
     console.log("[DEBUG] Conteúdo de pdfjsLib (após tentativa de .default):", typeof pdfjsLib === 'object' ? Object.keys(pdfjsLib) : pdfjsLib);
}



export const config = {
    api: {
        bodyParser: false, // Necessário para o formidable processar o upload de arquivos
    },
};

// Função auxiliar para extrair texto de PDF
async function extractTextFromPdf(filePath) { if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
        console.error("[ERROR] Falha crítica: pdfjsLib.getDocument não é uma função válida.");
        console.error("[DEBUG] Valor de pdfjsLib ao chamar getDocument:", pdfjsLib);
        throw new Error('Biblioteca PDF não carregou corretamente ou getDocument não é uma função.');
    }
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

    // Verifica se o pdfjsLib foi carregado corretamente no início do handler
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
        console.error("[ERROR] Handler iniciado, mas pdfjsLib.getDocument não está disponível.");
        return res.status(500).json({ error: "Dependência crítica para PDF (pdfjsLib.getDocument) não carregada no servidor."});
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
        res.status(500).json({ error: userMessage, details: error.message });
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
