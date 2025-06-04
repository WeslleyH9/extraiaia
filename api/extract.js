// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
// --- INÍCIO DO BLOCO DE DIAGNÓSTICO PDFJS-DIST ---
let pdfjsLibModule;
let getDocumentFunction;
let pdfjsErrorMessage = "pdfjs-dist não pôde ser carregado.";

try {
    console.log("Tentando importar 'pdfjs-dist/legacy/build/pdf.js'...");
    const legacyPdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    console.log("'pdfjs-dist/legacy/build/pdf.js' importado. Tipo de getDocument:", typeof legacyPdfjs.getDocument);
    if (typeof legacyPdfjs.getDocument === 'function') {
        pdfjsLibModule = legacyPdfjs;
        getDocumentFunction = legacyPdfjs.getDocument;
        pdfjsErrorMessage = null; // Sucesso
    } else {
        pdfjsErrorMessage = "'legacy/build/pdf.js': getDocument não é uma função.";
    }
} catch (e1) {
    console.error("Erro ao importar 'pdfjs-dist/legacy/build/pdf.js':", e1.message);
    pdfjsErrorMessage = `Erro legacy: ${e1.message}`;
    try {
        console.log("Tentando importar 'pdfjs-dist' (principal)...");
        const mainPdfjs = await import('pdfjs-dist');
        console.log("'pdfjs-dist' (principal) importado. Tipo de getDocument:", typeof mainPdfjs.getDocument);
        if (typeof mainPdfjs.getDocument === 'function') {
            pdfjsLibModule = mainPdfjs;
            getDocumentFunction = mainPdfjs.getDocument;
            pdfjsErrorMessage = null; // Sucesso
            // Se a importação principal funcionar, pode precisar do worker, mas o erro atual é MODULE_NOT_FOUND
            console.warn("AVISO: Usando a build principal de pdfjs-dist. Pode precisar de configuração de worker se o erro mudar.");
        } else {
             pdfjsErrorMessage = `'pdfjs-dist' (principal): getDocument não é uma função. Conteúdo: ${JSON.stringify(mainPdfjs)}`;
        }
    } catch (e2) {
        console.error("Erro ao importar 'pdfjs-dist' (principal):", e2.message);
        pdfjsErrorMessage = pdfjsErrorMessage + ` | Erro principal: ${e2.message}`;
    }
}
console.log("Status final do carregamento de pdfjs-dist:", pdfjsErrorMessage || "Carregado com sucesso!");
// --- FIM DO BLOCO DE DIAGNÓSTICO PDFJS-DIST ---
export const config = {
    api: {
        bodyParser: false, // Necessário para o formidable processar o upload
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

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const form = formidable({});

    try {
        // O formidable.parse agora retorna uma Promise, então usamos await
        const [fields, files] = await form.parse(req);

        if (!files.document || files.document.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }

        const uploadedFile = files.document[0];
        const filePath = uploadedFile.filepath; 
        const originalFilename = uploadedFile.originalFilename;
        const mimeType = uploadedFile.mimetype;

        console.log(`Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}, Caminho no servidor: ${filePath}`);

        let extractedText = "";

        if (mimeType === 'application/pdf') {
            try {
                extractedText = await extractTextFromPdf(filePath);
                console.log("Texto extraído de PDF usando pdfjs-dist.");
            } catch (pdfError) {
                console.error("Erro ao extrair PDF com pdfjs-dist:", pdfError);
                extractedText = "Erro ao processar arquivo PDF. Tente novamente ou use outro formato.";
                 // Retorna um erro mais específico se o processamento do PDF falhar
                return res.status(500).json({ error: "Falha ao processar o conteúdo do PDF.", details: pdfError.message });
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') { // DOCX
            const result = await mammoth.extractRawText({ path: filePath });
            extractedText = result.value;
            console.log("Texto extraído de DOCX.");
        } else if (mimeType === 'application/msword') { // DOC
            try {
                const result = await mammoth.extractRawText({ path: filePath });
                extractedText = result.value;
                console.log("Tentativa de extração de DOC com Mammoth.");
                if (!extractedText || !extractedText.trim()) {
                     extractedText = "Não foi possível extrair texto deste arquivo .doc. Tente converter para .docx ou .pdf.";
                }
            } catch (docError) {
                console.error("Erro ao ler .doc com Mammoth:", docError);
                extractedText = "Erro ao processar arquivo .doc. Considere converter para .docx ou .pdf.";
            }
        } else if (mimeType === 'text/plain') { // TXT
            extractedText = await fs.readFile(filePath, 'utf8');
            console.log("Texto extraído de TXT.");
        } else {
            // Limpar o arquivo temporário mesmo se o formato não for suportado
            await fs.unlink(filePath).catch(err => console.error("Erro ao deletar arquivo temporário (tipo não suportado):", err));
            return res.status(400).json({ error: `Formato de arquivo não suportado: ${mimeType}` });
        }

        // Limpar o arquivo temporário após o uso bem-sucedido
        await fs.unlink(filePath).catch(err => console.error("Erro ao deletar arquivo temporário:", err));

        res.status(200).json({
            message: `Arquivo "${originalFilename}" processado!`,
            extractedTextPreview: extractedText.substring(0, 1000) + (extractedText.length > 1000 ? "..." : ""), // Aumentei a prévia
        });

    } catch (error) {
        console.error('Erro geral no processamento do arquivo:', error);
        let userMessage = "Ocorreu um erro no servidor ao processar o arquivo.";
        if (error.message.includes("formidable") || error.message.includes("Part")) { // Erros comuns do formidable
             userMessage = "Erro no upload do arquivo. Verifique o arquivo e tente novamente.";
        }
        res.status(500).json({ error: userMessage, details: error.message });
    }
}
