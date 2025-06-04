// api/extract.js
import formidable from 'formidable'; // Para lidar com o upload de arquivos
import fs from 'fs/promises'; // Para interagir com o sistema de arquivos (se necessário)
import pdf from 'pdf-parse'; // Para ler PDFs
import mammoth from 'mammoth'; // Para ler DOCX

// Esta configuração diz ao Vercel para não analisar o corpo da requisição por padrão,
// pois o formidable fará isso.
export const config = {
    api: {
        bodyParser: false,
    },
};

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
        const filePath = uploadedFile.filepath; // Caminho temporário do arquivo no servidor
        const originalFilename = uploadedFile.originalFilename;
        const mimeType = uploadedFile.mimetype;

        console.log(`Arquivo recebido: ${originalFilename}, Tipo: ${mimeType}, Caminho no servidor: ${filePath}`);

        let extractedText = "";

        if (mimeType === 'application/pdf') {
            const dataBuffer = await fs.readFile(filePath);
            const data = await pdf(dataBuffer);
            extractedText = data.text;
            console.log("Texto extraído de PDF.");
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') { // DOCX
            const result = await mammoth.extractRawText({ path: filePath });
            extractedText = result.value;
            console.log("Texto extraído de DOCX.");
        } else if (mimeType === 'application/msword') { // DOC (suporte pode ser limitado)
             // Mammoth pode tentar ler .doc, mas com limitações.
             // Para um suporte robusto a .doc, bibliotecas adicionais ou conversão seriam necessárias.
             // Por agora, vamos tentar com Mammoth, mas avisar sobre limitações.
            try {
                const result = await mammoth.extractRawText({ path: filePath });
                extractedText = result.value;
                console.log("Tentativa de extração de DOC com Mammoth.");
                if (!extractedText.trim()) {
                     extractedText = "Não foi possível extrair texto deste arquivo .doc com a biblioteca atual. Tente converter para .docx ou .pdf.";
                }
            } catch (docError) {
                console.error("Erro ao ler .doc com Mammoth:", docError);
                extractedText = "Erro ao processar arquivo .doc. Considere converter para .docx ou .pdf.";
            }
        } else if (mimeType === 'text/plain') { // TXT
            extractedText = await fs.readFile(filePath, 'utf8');
            console.log("Texto extraído de TXT.");
        } else {
            return res.status(400).json({ error: `Formato de arquivo não suportado: ${mimeType}` });
        }

        // Limpar o arquivo temporário após o uso
        await fs.unlink(filePath).catch(err => console.error("Erro ao deletar arquivo temporário:", err));

        // *** PONTO DE INTEGRAÇÃO COM A API DO GEMINI VIRÁ AQUI ***
        // Por enquanto, vamos apenas retornar um trecho do texto extraído e uma mensagem.

        res.status(200).json({
            message: `Arquivo "${originalFilename}" processado!`,
            extractedTextPreview: extractedText.substring(0, 500) + (extractedText.length > 500 ? "..." : ""),
            // futuramente aqui viriam os dados estruturados do Gemini
        });

    } catch (error) {
        console.error('Erro no processamento do arquivo:', error);
        // Se houver erro de parse do formidable ou leitura de arquivo
        let userMessage = "Ocorreu um erro ao processar o arquivo.";
        if (error.message.includes("formidable")) {
             userMessage = "Erro no upload do arquivo. Tente novamente.";
        }
        res.status(500).json({ error: userMessage, details: error.message });
    }
}