// api/extract.js
import formidable from 'formidable';
import fs from 'fs/promises';
import mammoth from 'mammoth';
// Importa a versão 'legacy' do pdfjs-dist que tende a funcionar melhor em Node.js
// sem a necessidade de configurar um 'worker' separado explicitamente.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

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
