// api/extract.js
import fs from 'fs/promises'; // Usaremos 'fs' para verificar a existência de arquivos
import path from 'path';     // Usaremos 'path' para construir caminhos

// Não vamos importar formidable ou mammoth agora para simplificar o teste.
// Não vamos importar pdfjs-dist diretamente no topo ainda.

export const config = {
    api: {
        // bodyParser: false, // Vamos comentar por enquanto, já que não vamos usar formidable
    },
};

export default async function handler(req, res) {
    console.log(`[${new Date().toISOString()}] Handler /api/extract chamado para diagnóstico.`);

    const checks = {};
    const basePath = '/var/task/node_modules/pdfjs-dist'; // Caminho base no ambiente Vercel

    try {
        // Checar se a pasta principal do pdfjs-dist existe
        try {
            await fs.access(basePath, fs.constants.F_OK);
            checks.pdfjsDistFolderExists = true;
            console.log(`Pasta ${basePath} EXISTE.`);
        } catch (e) {
            checks.pdfjsDistFolderExists = false;
            console.error(`Pasta ${basePath} NÃO EXISTE ou não é acessível. Erro: ${e.message}`);
        }

        // Checar o arquivo da build legacy
        const legacyPath = path.join(basePath, 'legacy/build/pdf.js');
        try {
            await fs.access(legacyPath, fs.constants.F_OK);
            checks.legacyBuildExists = true;
            console.log(`Arquivo ${legacyPath} EXISTE.`);
        } catch (e) {
            checks.legacyBuildExists = false;
            console.error(`Arquivo ${legacyPath} NÃO EXISTE ou não é acessível. Erro: ${e.message}`);
        }

        // Checar o arquivo da build principal
        const mainBuildPath = path.join(basePath, 'build/pdf.mjs');
        try {
            await fs.access(mainBuildPath, fs.constants.F_OK);
            checks.mainBuildExists = true;
            console.log(`Arquivo ${mainBuildPath} EXISTE.`);
        } catch (e) {
            checks.mainBuildExists = false;
            console.error(`Arquivo ${mainBuildPath} NÃO EXISTE ou não é acessível. Erro: ${e.message}`);
        }

        // Checar o arquivo do worker
        const workerPath = path.join(basePath, 'build/pdf.worker.mjs');
        try {
            await fs.access(workerPath, fs.constants.F_OK);
            checks.workerExists = true;
            console.log(`Arquivo ${workerPath} EXISTE.`);
        } catch (e) {
            checks.workerExists = false;
            console.error(`Arquivo ${workerPath} NÃO EXISTE ou não é acessível. Erro: ${e.message}`);
        }

        // Tentar importar a build legacy se ela existir
        let legacyImportMessage = "Não tentado devido à ausência do arquivo.";
        if (checks.legacyBuildExists) {
            try {
                const legacyModule = await import('pdfjs-dist/legacy/build/pdf.js');
                if (legacyModule && typeof legacyModule.getDocument === 'function') {
                    legacyImportMessage = "Importado com SUCESSO, getDocument é uma função.";
                } else {
                    legacyImportMessage = "Importado, mas getDocument NÃO é uma função ou módulo vazio.";
                }
            } catch (e) {
                legacyImportMessage = `ERRO ao importar: ${e.message}`;
            }
        }
        checks.legacyImportAttempt = legacyImportMessage;
        console.log(`Resultado da tentativa de importação legacy: ${legacyImportMessage}`);


        return res.status(200).json({
            message: "Diagnóstico de pdfjs-dist concluído.",
            checks: checks
        });

    } catch (error) {
        console.error('Erro no handler de diagnóstico:', error);
        return res.status(500).json({ error: "Erro no servidor durante o diagnóstico.", details: error.message, checks });
    }
}
