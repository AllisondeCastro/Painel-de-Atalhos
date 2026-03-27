// ==UserScript==
// @name         Painel de atalhos para minuta de Triagem EPROC
// @namespace    http://tampermonkey.net/
// @version      7.1
// @description  Dashboard Multi-Minutas
// @author       Allison de Castro Silva
// @match        https://eproc1g.tjmg.jus.br/eproc/controlador.php?acao=minuta_editar*
// @updateURL    https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPOSITORIO/main/NOME_DO_ARQUIVO.user.js
// @downloadURL  https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPOSITORIO/main/NOME_DO_ARQUIVO.user.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. BANCO DE DADOS E ESTRUTURA DE PERFIS
    // ==========================================

    const perfisPadrao =[
        {
            "id": "perfil_triagem",
            "nome": "Certidão de Triagem",
            "keywords": "Certidão de Triagem",
            "regras":[
                {
                    "id": "item3_rg",
                    "category": "3 RG",
                    "name": "10 anos",
                    "target": "( ) Desatualizado/inexistente/desconforme -",
                    "isRegex": false,
                    "novo": "( X ) desatualizado. Emitido em período superior a 10 anos da distribuição da ação - ",
                    "bold": true,
                    "italic": false,
                    "font": ""
                },
                {
                    "id": "item3_assinatura",
                    "category": "3 RG",
                    "name": "Assin. Divergente",
                    "target": "( ) Desatualizado/inexistente/desconforme -",
                    "isRegex": false,
                    "novo": "( X ) insuficiente. assinatura diverge do documento de identificação juntado aos autos - ",
                    "bold": true,
                    "italic": false,
                    "font": ""
                },
                {
                    "id": "item4_residencia90",
                    "category": "4 Endereço",
                    "name": "90 dias",
                    "target": "( ) insuficiente (desatualizado e/ou em nome de 3º sem comprovação) -",
                    "isRegex": false,
                    "novo": "(  X  ) desatualizado. Datado de período superior a 90 dias da distribuição da ação - ",
                    "bold": true,
                    "italic": false,
                    "font": ""
                },
                {
                    "id": "item4_inexistente",
                    "category": "4 Endereço",
                    "name": "Inexistente",
                    "target": "( ) insuficiente (desatualizado e/ou em nome de 3º sem comprovação) -",
                    "isRegex": false,
                    "novo": "( X ) Inexistente. Comprovante de endereço, em nome da parte autora, ou de pessoa com quem comprove vínculo, datado de ao menos 90 dias da distribuição da demanda, podendo ser contas de luz ou água, boletos de contas bancárias, fatura de cartão de crédito, plano de saúde, tv por assinatura, streaming, linhas de celular. ",
                    "bold": true,
                    "italic": false,
                    "font": ""
                },
                {
                    "id": "item4_insuficiente",
                    "category": "4 Endereço",
                    "name": "Insuficiente",
                    "target": "( ) insuficiente (desatualizado e/ou em nome de 3º sem comprovação) -",
                    "isRegex": false,
                    "novo": "( X ) insuficiente. Comprovante de endereço, em nome da parte autora, ou de pessoa com quem comprove vínculo, datado de ao menos 90 dias da distribuição da demanda, podendo ser contas de luz ou água, boletos de contas bancárias, fatura de cartão de crédito, plano de saúde, tv por assinatura, streaming, linhas de celular - ",
                    "bold": true,
                    "italic": false,
                    "font": ""
                },
                {
                    "id": "item5_digital",
                    "category": "5 Assinatura",
                    "name": "Digital",
                    "target": "( ) desconforme –motivo :",
                    "isRegex": false,
                    "novo": "( X ) desconforme. Motivo: não foi possível certificar a autenticidade da assinatura digital -  \n",
                    "bold": true,
                    "italic": false,
                    "font": ""
                },
                {
                    "id": "regra_1773139643710",
                    "category": "5 Assinatura",
                    "name": "1 Ano",
                    "target": "(   ) desconforme –motivo :",
                    "isRegex": false,
                    "novo": "( X ) Desconforme. Motivo: documento datado superior a um ano da distribuição da demanda. - ",
                    "bold": true,
                    "italic": false,
                    "font": ""
                },
                {
                    "id": "regra_1773829306382",
                    "category": "6 AJG",
                    "name": "SEM Rendimentos",
                    "target": "(   ) há pedido de AJG sem comprovação de rendimentos",
                    "isRegex": false,
                    "novo": "(  X ) há pedido de AJG sem comprovação de rendimentos.",
                    "bold": true,
                    "italic": false,
                    "font": ""
                }
            ]
        }
    ];

    let perfisSalvos =[];
    try {
        let saved = typeof GM_getValue !== 'undefined' ? GM_getValue('tm_eproc_perfis_v6') : localStorage.getItem('tm_eproc_perfis_v6');
        perfisSalvos = typeof saved === 'string' ? JSON.parse(saved) : (saved || perfisPadrao);
    } catch(e) { perfisSalvos = perfisPadrao; }

    if (!Array.isArray(perfisSalvos) || perfisSalvos.length === 0) perfisSalvos = perfisPadrao;

    let perfilAtivo = null;
    let perfilEditandoId = null;

    function salvarPerfis() {
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('tm_eproc_perfis_v6', JSON.stringify(perfisSalvos));
        } else {
            localStorage.setItem('tm_eproc_perfis_v6', JSON.stringify(perfisSalvos));
        }
    }

    function traduzirKeywordParaEproc(texto) {
        return texto.trim()
            .replace(/[ÁÀÃÂÄáàãâä]/g, '.')
            .replace(/[ÉÈÊËéèêë]/g, '.')
            .replace(/[ÍÌÎÏíìîï]/g, '.')
            .replace(/[ÓÒÕÔÖóòõôö]/g, '.')
            .replace(/[ÚÙÛÜúùûü]/g, '.')
            .replace(/[Çç]/g, '.');
    }

    function detectarPerfilAtual() {
        let win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const title = document.title || '';

        let headerTexts =[];
        let elementos = document.querySelectorAll('#lblInfraDescricaoTela, .infraAreaTelaDsc, #selTipoDocumento, #txtDescricao, #txtNomeDocumento, #txtNomeMinuta, input[type="text"], select');

        elementos.forEach(el => {
            if (el.tagName && el.tagName.toLowerCase() === 'select') {
                if (el.selectedIndex >= 0 && el.options[el.selectedIndex]) {
                    headerTexts.push(el.options[el.selectedIndex].text);
                }
            } else {
                headerTexts.push(el.textContent || el.value || '');
            }
        });

        let editorContent = '';
        try {
            let editor = obterEditorValido();
            if (editor && editor.document && editor.document.getBody()) {
                editorContent = editor.document.getBody().getText().substring(0, 4000);
            }
        } catch(e) {}

        const textToSearch = (title + " " + headerTexts.join(' ') + " " + editorContent).replace(/\s+/g, ' ');

        perfilAtivo = null;
        for (let p of perfisSalvos) {
            if (!p.keywords) continue;
            let chaves = p.keywords.split(',').map(k => traduzirKeywordParaEproc(k).trim()).filter(k => k);
            if (chaves.some(k => new RegExp(k, 'i').test(textToSearch))) {
                perfilAtivo = p;
                break;
            }
        }
    }

    // ==========================================
    // 2. MOTOR SMART INVISÍVEL E CURSOR SMART
    // ==========================================

    function construirRegexInteligente(textoPlano) {
        let str = textoPlano.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        str = str.replace(/\\\([\s\xA0Xx\u00A0]*\\\)/g, '\\(\\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\\s)*\\s*\\)');
        str = str.replace(/[\s\xA0\u00A0]+/g, '(?:<[^>]*>|&nbsp;|&#160;|\u00A0|\\s)+');
        str = str.replace(/[áàãâäéèêëíìîïóòõôöúùûüçºª\-\–\—]/gi, '(?:<[^>]*>)*(?:&[a-zA-Z0-9#]+;|[\\s\\S])(?:<[^>]*>)*');
        return str;
    }

    function obterEditorValido() {
        let win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (!win.CKEDITOR || !win.CKEDITOR.instances) return null;
        if (typeof win.current_editor === 'function' && win.current_editor()) {
            let active = win.CKEDITOR.instances[win.current_editor()];
            if (active && !active.readOnly) return active;
        }
        for (let key in win.CKEDITOR.instances) {
            let ed = win.CKEDITOR.instances[key];
            if (ed && !ed.readOnly) return ed;
        }
        return null;
    }

    function processarAcaoNoEditor(regraId) {
        if (!perfilAtivo) return;
        const regra = perfilAtivo.regras.find(r => r.id === regraId);
        if (!regra) return;

        let editor = obterEditorValido();
        if (editor) {
            let scrollX = window.scrollX;
            let scrollY = window.scrollY;

            let body = editor.document.getBody();
            let originalHtml = body.getHtml();
            let foiSubstituido = false;

            let textoInsercao = regra.novo.replace(/\r?\n/g, '<br>');
            if (regra.italic) textoInsercao = `<em>${textoInsercao}</em>`;
            if (regra.bold) textoInsercao = `<strong>${textoInsercao}</strong>`;
            if (regra.font) textoInsercao = `<span style="font-family: ${regra.font};">${textoInsercao}</span>`;

            let regexStr;
            if (regra.isRegex) {
                regexStr = regra.target;
            } else {
                regexStr = construirRegexInteligente(regra.target);
            }

            let targetRegex;
            try {
                targetRegex = new RegExp(regexStr, 'i'); // Substitui apenas o 1º mais proximo
            } catch (e) {
                showToast("Expressão Regular inválida no botão '" + regra.name + "'.", true);
                return;
            }

            let replaceCount = 0;
            const baseId = 'tm-cursor-' + Date.now();

            let selection = editor.getSelection();
            let bookmarks = selection ? selection.createBookmarks() :[];
            let htmlWithBookmarks = body.getHtml();

            let bmRegex = /<span[^>]*data-cke-bookmark[^>]*>.*?<\/span>/i;
            let splitHtml = htmlWithBookmarks.split(bmRegex);

            let antes = splitHtml[0] || '';
            let depois = splitHtml.length > 1 ? splitHtml.slice(1).join('') : '';
            let bmTag = htmlWithBookmarks.match(bmRegex) ? htmlWithBookmarks.match(bmRegex)[0] : '';

            let applyReplacement = function(textStr) {
                let didReplace = false;
                let newStr = textStr.replace(targetRegex, function() {
                    if (didReplace) return arguments[0];
                    didReplace = true;
                    foiSubstituido = true;
                    replaceCount++;
                    return textoInsercao + `<span id="${baseId}-${replaceCount}"></span>`;
                });
                return { newStr, didReplace };
            };

            let resDepois = applyReplacement(depois);
            if (resDepois.didReplace) {
                depois = resDepois.newStr;
            } else {
                let resAntes = applyReplacement(antes);
                if (resAntes.didReplace) {
                    antes = resAntes.newStr;
                }
            }

            editor.fire('saveSnapshot');

            if (foiSubstituido) {
                body.setHtml(antes + bmTag + depois);
                let win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                let firstMarker = editor.document.getById(`${baseId}-1`);
                if (firstMarker) {
                    let range = editor.createRange();
                    range.moveToPosition(firstMarker, win.CKEDITOR ? win.CKEDITOR.POSITION_BEFORE_START : 1);
                    editor.getSelection().selectRanges([range]);
                } else if (selection) {
                    selection.selectBookmarks(bookmarks);
                }

                for(let i = 1; i <= replaceCount; i++) {
                    let m = editor.document.getById(`${baseId}-${i}`);
                    if (m) m.remove();
                }
                editor.focus();
                // NOTA: O Toast de Sucesso foi removido daqui para evitar poluição visual conforme solicitado
            } else {
                if (selection) selection.selectBookmarks(bookmarks);
                showToast("⚠️ O 'Texto Alvo' não foi encontrado na minuta.", true);
            }

            editor.fire('saveSnapshot');
            window.scrollTo(scrollX, scrollY);
        } else {
            showToast("Editor editável não encontrado. Aguarde o carregamento.", true);
        }
    }

    function desfazerUltimaAcao() {
        let editor = obterEditorValido();
        if (editor) editor.execCommand('undo');
    }

    function showToast(message, isError = false, duration = 3000) {
        let toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: ${isError ? 'rgba(220, 53, 69, 0.95)' : 'rgba(40, 167, 69, 0.95)'}; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 99999999; opacity: 0; transition: opacity 0.3s, bottom 0.3s; pointer-events: none; font-family: sans-serif; backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); text-align: center; max-width: 80%;`;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '1'; toast.style.bottom = '90px'; }, 10);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.bottom = '80px'; setTimeout(() => toast.remove(), 300); }, duration);
    }

    // ==========================================
    // 2.5 MOTOR DE AUTO-PREENCHIMENTO GATILHO-LINK (ESTÁVEL V6.3/6.8)
    // ==========================================

    function iniciarMonitoramentoAutoX() {
        let win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (!win.CKEDITOR) return;

        function attachAutoX(editor) {
            if (!editor || editor._autoXAttached) return;
            editor._autoXAttached = true;
            editor._justPastedLink = false;

            editor.on('paste', function(evt) {
                let pastedText = evt.data.dataValue || '';
                if (/(https?:\/\/[^\s]+|eproc1g\.tjmg\.jus\.br|tjmg\.jus\.br|<a\b[^>]*href=["'][^"']+["']|widgetlinkdocumento|data-iddocumento|evento=|processo=)/i.test(pastedText)) {
                    editor._justPastedLink = true;
                    clearTimeout(editor._pasteLinkTimeout);
                    editor._pasteLinkTimeout = setTimeout(() => { editor._justPastedLink = false; }, 800);
                }
            });

            editor.on('change', function() {
                if (editor._isApplyingAutoX) return;
                if (!editor._justPastedLink) return;

                editor._justPastedLink = false;

                try {
                    let selection = editor.getSelection();
                    if (!selection) return;

                    let ranges = selection.getRanges();
                    if (!ranges || ranges.length === 0) return;

                    let startNode = ranges[0].startContainer;
                    let block = startNode;

                    while (block && typeof block.getName !== 'function') {
                        block = block.getParent();
                    }

                    let dtd = win.CKEDITOR.dtd;
                    let blockDtd = Object.assign({}, dtd.$block, dtd.$listItem, dtd.$tableContent);

                    while (block && !blockDtd[block.getName()] && block.getName() !== 'body') {
                        block = block.getParent();
                    }

                    if (!block || block.getName() === 'body') return;

                    let regexEmptyTest = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|\s)*\)/;
                    let regexEmptyGlobal = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|\s)*\)/g;

                    let htmlPre = block.getHtml();

                    if (regexEmptyTest.test(htmlPre)) {
                        editor._isApplyingAutoX = true;

                        let parentScrollX = win.scrollX;
                        let parentScrollY = win.scrollY;

                        let iframeWindow = editor.window ? editor.window.$ : null;
                        let iframeScrollX = iframeWindow ? iframeWindow.scrollX : 0;
                        let iframeScrollY = iframeWindow ? iframeWindow.scrollY : 0;

                        let contentsElement = editor.ui.space('contents');
                        let originalHeight = '';
                        if (contentsElement) {
                            originalHeight = contentsElement.getStyle('height') || '';
                            contentsElement.setStyle('height', contentsElement.$.offsetHeight + 'px');
                        }

                        let bookmarks = selection.createBookmarks();
                        let htmlWithBookmarks = block.getHtml();

                        // SEPARADOR PERFEITO: Previne marcações indevidas em linhas ou tabelas erradas.
                        let blockBoundaryRegex = /(<br\s*\/?>|<\/?p\b[^>]*>|<\/?div\b[^>]*>|<\/?li\b[^>]*>|<\/?td\b[^>]*>|<\/?h[1-6]\b[^>]*>)/gi;
                        let bmRegex = /<span[^>]*data-cke-bookmark[^>]*>.*?<\/span>/i;

                        let parts = htmlWithBookmarks.split(blockBoundaryRegex);
                        let changed = false;

                        for (let i = 0; i < parts.length; i++) {
                            if (i % 2 !== 0) continue;

                            let line = parts[i];

                            let regexExcecao1 = /(?:N(?:a|ã|&atilde;|&#227;|)o|Sim)\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|:|-|\s)*\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\s)*\)/i;
                            let regexExcecao2 = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\s)*\)\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|:|-|\s)*(?:N(?:a|ã|&atilde;|&#227;|)o|Sim)/i;
                            let regexExcecao3 = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\s)*\)\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0)*desconforme\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|–|-|—|\s)*motivo/i;

                            if (regexExcecao1.test(line) || regexExcecao2.test(line) || regexExcecao3.test(line)) continue;

                            if (bmRegex.test(line) && regexEmptyTest.test(line)) {
                                let bmMatch = line.match(bmRegex);
                                let firstBmIndex = line.indexOf(bmMatch[0]);

                                let antes = line.substring(0, firstBmIndex);
                                let depois = line.substring(firstBmIndex);

                                let matchLeft, lastLeftIndex = -1, lastLeftLength = 0;
                                regexEmptyGlobal.lastIndex = 0;

                                while ((matchLeft = regexEmptyGlobal.exec(antes)) !== null) {
                                    lastLeftIndex = matchLeft.index;
                                    lastLeftLength = matchLeft[0].length;
                                }

                                if (lastLeftIndex !== -1) {
                                    antes = antes.substring(0, lastLeftIndex) + '( X )' + antes.substring(lastLeftIndex + lastLeftLength);
                                    parts[i] = antes + depois;
                                    changed = true;
                                } else {
                                    regexEmptyGlobal.lastIndex = 0;
                                    let matchRight = regexEmptyGlobal.exec(depois);
                                    if (matchRight) {
                                        depois = depois.substring(0, matchRight.index) + '( X )' + depois.substring(matchRight.index + matchRight[0].length);
                                        parts[i] = antes + depois;
                                        changed = true;
                                    }
                                }
                                break;
                            }
                        }

                        if (changed) {
                            block.setHtml(parts.join(''));
                            selection.selectBookmarks(bookmarks);
                            editor.fire('saveSnapshot');
                        } else {
                            selection.selectBookmarks(bookmarks);
                        }

                        if (contentsElement) contentsElement.setStyle('height', originalHeight);
                        if (iframeWindow) iframeWindow.scrollTo(iframeScrollX, iframeScrollY);
                        win.scrollTo(parentScrollX, parentScrollY);

                        setTimeout(() => { editor._isApplyingAutoX = false; }, 10);
                    }
                } catch (e) {
                    editor._isApplyingAutoX = false;
                    console.error("Erro interno no Auto-X Eproc:", e);
                }
            });
        }

        for (let key in win.CKEDITOR.instances) {
            attachAutoX(win.CKEDITOR.instances[key]);
        }
        win.CKEDITOR.on('instanceReady', function(evt) {
            attachAutoX(evt.editor);
        });
    }

    // ==========================================
    // 3. CRIAÇÃO DA INTERFACE (UI)
    // ==========================================

    function importarArquivoJSON(callback) {
        let input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = e => {
            let file = e.target.files[0];
            if (!file) return;
            let reader = new FileReader();
            reader.readAsText(file, 'UTF-8');
            reader.onload = readerEvent => {
                try {
                    let content = JSON.parse(readerEvent.target.result);
                    callback(content);
                } catch(err) {
                    showToast("Arquivo selecionado é inválido ou corrompido!", true);
                }
            }
        }
        input.click();
    }

    function criarInterface() {
        if (document.getElementById('tm-container-geral')) return;

        detectarPerfilAtual();
        const iniciaAberto = perfilAtivo !== null;
        const fabClass = iniciaAberto ? 'tm-hidden' : '';
        const painelClass = iniciaAberto ? 'tm-visible' : '';

        const container = document.createElement('div');
        container.id = 'tm-container-geral';

        const iconeStandby = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`;
        const iconeDesfazer = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`;
        const iconeEngrenagem = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
        const iconeOlho = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

        container.innerHTML = `
            <div id="tm-fab" class="${fabClass}" title="Abrir ferramentas">${iconeStandby}</div>

            <div id="tm-painel-textos" class="${painelClass}">
                <div id="tm-container-dinamico" style="display: flex; flex-direction: column; gap: 4px;"></div>
                <div class="tm-footer-bar">
                    <div style="display: flex; gap: 4px; align-items: center;">
                        <button type="button" class="tm-btn-acao" id="tm-desfazer" title="Desfazer (Ctrl+Z)">${iconeDesfazer}</button>
                        <button type="button" class="tm-btn-acao" id="tm-abrir-config" title="Configurar Ações e Perfis">${iconeEngrenagem}</button>
                        <button type="button" class="tm-btn-acao tm-btn-olho" id="tm-abrir-digitos" title="Tabela de Dígitos">${iconeOlho}</button>
                    </div>
                    <button type="button" class="tm-btn-min" id="tm-minimizar">Ocultar</button>
                </div>
            </div>

            <div id="tm-modal-config" class="tm-modal-overlay">
                <div class="tm-modal-content" style="min-width: 600px; width: 680px;">
                    <div class="tm-modal-header">Gestão de Atalhos e Modelos de Minuta</div>

                    <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                            <label class="tm-label-dig" style="margin:0;">Modelo Selecionado:</label>
                            <select id="tm-cfg-perfil-select" class="tm-input" style="flex:1; margin:0;"></select>

                            <button type="button" id="tm-btn-exp-perfil" class="tm-botao" style="background: rgba(255, 255, 255, 0.1); padding: 5px 8px;" title="Exportar este Modelo">⬆️</button>
                            <button type="button" id="tm-btn-imp-perfil" class="tm-botao" style="background: rgba(255, 255, 255, 0.1); padding: 5px 8px;" title="Importar um Modelo">⬇️</button>

                            <button type="button" id="tm-btn-novo-perfil" class="tm-botao" style="background: rgba(0, 123, 255, 0.4); border: 1px solid #0056b3;">+ Novo Modelo</button>
                            <button type="button" id="tm-btn-excluir-perfil" class="tm-botao" style="background: rgba(220, 53, 69, 0.3); border: 1px solid #dc3545; color: #ff6b6b;">Excluir Modelo</button>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <label class="tm-label-dig">Palavra-Chave do Título (Pode escrever normal com acentos, o sistema traduz para o Eproc):</label>
                            <input type="text" id="tm-cfg-perfil-keywords" class="tm-input" placeholder="Ex: Certidão de Triagem, Despacho Inicial">
                        </div>
                    </div>

                    <div style="display: flex; gap: 20px;">
                        <div style="flex: 1; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 15px; display: flex; flex-direction: column;">
                            <h4 style="font-size: 11px; margin:0 0 8px 0; color:#aaa;">Atalhos deste modelo:</h4>
                            <div id="tm-lista-config" style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 5px;"></div>
                            <button type="button" id="tm-btn-add-novo" class="tm-botao" style="margin-top: 10px; text-align: center; background: rgba(255,255,255,0.05); font-size: 12px; padding: 8px;">+ Adicionar Atalho</button>
                        </div>

                        <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;" id="tm-form-box">
                            <input type="hidden" id="tm-cfg-id">
                            <div style="display: flex; gap: 8px;">
                                <label class="tm-label-dig" style="display: flex; flex-direction: column; gap: 2px; flex:1;">Tópico/Categoria: <input type="text" id="tm-cfg-categoria" class="tm-input" placeholder="Ex: 1 Geral"></label>
                                <label class="tm-label-dig" style="display: flex; flex-direction: column; gap: 2px; flex:1;">Rótulo do Botão: <input type="text" id="tm-cfg-nome" class="tm-input"></label>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label class="tm-label-dig">Texto Alvo (a ser apagado/substituído):</label>
                                <div style="display: flex; gap: 8px;">
                                    <input type="text" id="tm-cfg-alvo" class="tm-input" placeholder="Cole ou capture na tela" style="flex: 1;">
                                    <button type="button" id="tm-btn-capturar-alvo" class="tm-botao" style="background: rgba(0, 129, 194, 0.4); border: 1px solid #0081c2; padding: 0 10px;" title="Capturar visualmente na minuta">🎯 Capturar</button>
                                </div>
                                <label class="tm-label-dig" style="display: flex; align-items: center; gap: 5px; margin-top: 4px;">
                                    <input type="checkbox" id="tm-cfg-isregex"> <strong>Avançado:</strong> O alvo é um Regex puro
                                </label>
                            </div>

                            <label class="tm-label-dig" style="display: flex; flex-direction: column; gap: 2px;">Novo Texto (A ser digitado): <textarea id="tm-cfg-novo" class="tm-input" style="resize: vertical; min-height: 45px;"></textarea></label>

                            <div style="display: flex; gap: 15px; align-items: center; margin-top: 2px;">
                                <label class="tm-label-dig" style="display: flex; align-items: center; gap: 5px;"><input type="checkbox" id="tm-cfg-bold"> <strong>Negrito</strong></label>
                                <label class="tm-label-dig" style="display: flex; align-items: center; gap: 5px;"><input type="checkbox" id="tm-cfg-italic"> <em>Itálico</em></label>
                            </div>

                            <div style="display: flex; gap: 10px; margin-top: auto; padding-top: 10px;">
                                <button type="button" id="tm-btn-salvar-regra" class="tm-botao" style="flex: 1; text-align: center; background: rgba(40, 167, 69, 0.3); border: 1px solid rgba(40,167,69,0.5); font-size: 12px; padding: 8px;">Salvar Atalho</button>
                                <button type="button" id="tm-btn-excluir-regra" class="tm-botao" style="flex: 1; text-align: center; background: rgba(220, 53, 69, 0.3); border: 1px solid rgba(220,53,69,0.5); font-size: 12px; padding: 8px;">Excluir Atalho</button>
                            </div>
                        </div>
                    </div>

                    <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
                        <div style="display: flex; gap: 10px;">
                            <button type="button" id="tm-btn-exportar-tudo" class="tm-botao" style="background: rgba(255,255,255,0.05); font-size: 11px; padding: 6px 12px;">⬆️ Exportar Backup</button>
                            <button type="button" id="tm-btn-importar-tudo" class="tm-botao" style="background: rgba(255,255,255,0.05); font-size: 11px; padding: 6px 12px;">⬇️ Importar Backup</button>
                        </div>
                        <button type="button" id="tm-fechar-config" class="tm-botao" style="padding: 6px 16px; font-size: 12px;">Fechar Janela</button>
                    </div>
                </div>
            </div>

            <div id="tm-modal-digitos" class="tm-modal-overlay">
                <div class="tm-modal-content" style="min-width: 300px;">
                    <div class="tm-modal-header">Escala por Dígitos</div>
                    <div class="tm-modal-row"><span class="tm-label-dig">Dígitos <strong class="tm-badge">0</strong></span><span class="tm-nome">Daniel Leite Chaves</span></div>
                    <div class="tm-modal-row"><span class="tm-label-dig">Dígitos <strong class="tm-badge">2, 4 e 6</strong></span><span class="tm-nome">Sabrina da Cunha Peixoto Ladeira</span></div>
                    <div class="tm-modal-row"><span class="tm-label-dig">Dígitos <strong class="tm-badge">1, 3, 5 e 8</strong></span><span class="tm-nome">Gustavo Câmara Corte Real</span></div>
                    <div class="tm-modal-row"><span class="tm-label-dig">Dígito <strong class="tm-badge">9</strong></span><span class="tm-nome">Douglas Silva Dias</span></div>
                    <div class="tm-modal-row"><span class="tm-label-dig">Dígito <strong class="tm-badge">7</strong></span><span class="tm-nome">Artur Bernardes Lopes Filho</span></div>
                    <div class="tm-modal-divider"><strong class="tm-title-bambui">Bambuí</strong></div>
                    <div class="tm-modal-row"><span class="tm-label-dig">Dígito <strong class="tm-badge">8</strong></span><span class="tm-nome">Artur Bernardes Lopes Filho</span></div>
                    <div class="tm-modal-row"><span class="tm-label-dig">Dígito <strong class="tm-badge">0, 2, 4, 6</strong></span><span class="tm-nome">Juliana Ferreira Sicuro de Moraes</span></div>
                </div>
            </div>
        `;

        document.body.appendChild(container);

        const fab = container.querySelector('#tm-fab');
        const painel = container.querySelector('#tm-painel-textos');
        const containerDinamico = container.querySelector('#tm-container-dinamico');
        const btnMinimizar = container.querySelector('#tm-minimizar');
        const btnDesfazer = container.querySelector('#tm-desfazer');
        const btnAbrirConfig = container.querySelector('#tm-abrir-config');
        const btnOlho = container.querySelector('#tm-abrir-digitos');
        const modalConfig = container.querySelector('#tm-modal-config');
        const modalDigitos = container.querySelector('#tm-modal-digitos');

        const selPerfil = container.querySelector('#tm-cfg-perfil-select');
        const btnNovoPerfil = container.querySelector('#tm-btn-novo-perfil');
        const btnExcluirPerfil = container.querySelector('#tm-btn-excluir-perfil');
        const inKeywords = container.querySelector('#tm-cfg-perfil-keywords');

        // ======================================================================
        // NOVO: SISTEMA POINT-AND-CLICK PARA CAPTURA CIRÚRGICA DE ALVO DIRETO NA MINUTA
        // ======================================================================
        let isCapturing = false;
        container.querySelector('#tm-btn-capturar-alvo').addEventListener('click', () => {
            let editor = obterEditorValido();
            if (!editor || !editor.document || !editor.document.$) {
                showToast("Editor carregando... Tente novamente em 2 segundos.", true);
                return;
            }

            modalConfig.classList.remove('tm-modal-active');
            isCapturing = true;
            showToast("🎯 MODO DE CAPTURA: Clique exatamente no texto/linha que deseja substituir. (ESC para cancelar)", false, 6000);

            let iframeDoc = editor.document.$;

            // 1. Injetar CSS de destaque de captura cirúrgica
            let styleEl = iframeDoc.createElement('style');
            styleEl.id = 'tm-capture-style';
            styleEl.innerHTML = `
                .tm-capturing-mode .tm-capture-hover-line {
                    cursor: crosshair !important;
                    border-radius: 2px;
                    transition: background-color 0.1s;
                }
                .tm-capturing-mode .tm-capture-hover-line:hover {
                    outline: 2px dashed #0081c2 !important;
                    background-color: rgba(0, 129, 194, 0.3) !important;
                    box-shadow: 0 0 0 2px rgba(0, 129, 194, 0.1) !important;
                }
                .tm-capturing-mode img { pointer-events: none !important; }
            `;
            iframeDoc.head.appendChild(styleEl);
            iframeDoc.body.classList.add('tm-capturing-mode');

            // 2. Embrulhar "TextNodes" (Faz com que cada linha literal ganhe um highlight independente)
            const walker = iframeDoc.createTreeWalker(iframeDoc.body, NodeFilter.SHOW_TEXT, null, false);
            const nodesToWrap =[];
            let node;
            while ((node = walker.nextNode())) {
                if (node.nodeValue.trim() !== '' &&
                    node.parentNode.nodeName !== 'SCRIPT' &&
                    node.parentNode.nodeName !== 'STYLE' &&
                    !node.parentNode.classList.contains('tm-capture-hover-line')) {
                    nodesToWrap.push(node);
                }
            }

            nodesToWrap.forEach(txtNode => {
                const span = iframeDoc.createElement('span');
                span.className = 'tm-capture-hover-line';
                span.textContent = txtNode.nodeValue;
                txtNode.parentNode.replaceChild(span, txtNode);
            });

            // 3. Função de Limpeza (Restaura o editor exatamente como estava)
            function stopCapture() {
                isCapturing = false;
                iframeDoc.body.classList.remove('tm-capturing-mode');
                let s = iframeDoc.getElementById('tm-capture-style');
                if (s) s.remove();

                // Desembrulhar as linhas cirurgicamente (sem destruir formatação)
                const spans = iframeDoc.querySelectorAll('.tm-capture-hover-line');
                spans.forEach(span => {
                    const parent = span.parentNode;
                    if (!parent) return;
                    while (span.firstChild) {
                        parent.insertBefore(span.firstChild, span);
                    }
                    parent.removeChild(span);
                });
                iframeDoc.body.normalize();

                iframeDoc.removeEventListener('click', clickHandler, true);
                iframeDoc.removeEventListener('keydown', keyHandler, true);
                document.removeEventListener('keydown', keyHandler, true);

                modalConfig.classList.add('tm-modal-active');
            }

            // 4. Handler de Clique de Seleção
            function clickHandler(e) {
                if (!isCapturing) return;
                e.preventDefault();
                e.stopPropagation();

                let target = e.target;
                let spanTarget = target.closest('.tm-capture-hover-line');

                let rawText = '';
                if (spanTarget) {
                    rawText = spanTarget.textContent;
                } else {
                    rawText = target.innerText || target.textContent || '';
                }

                // Limpeza pesada de caracteres especiais invisíveis de HTML
                let cleanedText = rawText.replace(/\s+/g, ' ').trim();

                if (cleanedText && cleanedText.length > 0) {
                    container.querySelector('#tm-cfg-alvo').value = cleanedText;
                    showToast("✅ Trecho capturado com sucesso!");
                } else {
                    showToast("⚠️ Espaço vazio capturado. Tente clicar exatamente no texto.", true);
                }
                stopCapture();
            }

            function keyHandler(e) {
                if (e.key === 'Escape' && isCapturing) {
                    showToast("Captura cancelada pelo usuário.", true);
                    stopCapture();
                }
            }

            iframeDoc.addEventListener('click', clickHandler, true);
            iframeDoc.addEventListener('keydown', keyHandler, true);
            document.addEventListener('keydown', keyHandler, true);
        });
        // ======================================================================

        function baixarJSON(objeto, nomeArquivo) {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(objeto, null, 2));
            const a = document.createElement('a');
            a.setAttribute("href", dataStr);
            a.setAttribute("download", nomeArquivo);
            document.body.appendChild(a);
            a.click();
            a.remove();
        }

        container.querySelector('#tm-btn-exportar-tudo').addEventListener('click', () => {
            baixarJSON(perfisSalvos, "eproc_atalhos_backup_geral.json");
        });

        container.querySelector('#tm-btn-importar-tudo').addEventListener('click', () => {
            if(!confirm("CUIDADO: Importar um backup geral apagará TODOS os seus modelos e atalhos atuais.\nDeseja continuar?")) return;

            importarArquivoJSON((data) => {
                if(Array.isArray(data) && data.length > 0 && data[0].regras) {
                    perfisSalvos = data;
                    salvarPerfis();
                    atualizarDropdownPerfis();
                    showToast("Backup Geral importado com sucesso!");
                } else {
                    showToast("O arquivo selecionado não parece ser um backup válido de atalhos.", true);
                }
            });
        });

        container.querySelector('#tm-btn-exp-perfil').addEventListener('click', () => {
            if(!perfilEditandoId) { showToast("Selecione um modelo primeiro.", true); return; }
            const p = perfisSalvos.find(x => x.id === perfilEditandoId);
            const safeName = p.nome.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            baixarJSON(p, `eproc_modelo_${safeName}.json`);
        });

        container.querySelector('#tm-btn-imp-perfil').addEventListener('click', () => {
            importarArquivoJSON((data) => {
                let perfilImportado = Array.isArray(data) ? data[0] : data;

                if(perfilImportado && perfilImportado.nome && perfilImportado.regras) {
                    perfilImportado.id = 'perfil_' + Date.now();
                    perfilImportado.nome = perfilImportado.nome + ' (Importado)';
                    perfisSalvos.push(perfilImportado);
                    perfilEditandoId = perfilImportado.id;
                    salvarPerfis();
                    atualizarDropdownPerfis();
                    showToast(`Modelo "${perfilImportado.nome}" carregado com sucesso!`);
                } else {
                    showToast("O arquivo selecionado não é um modelo válido.", true);
                }
            });
        });

        function renderPainelPrincipal() {
            containerDinamico.innerHTML = '';

            if (!perfilAtivo) {
                containerDinamico.innerHTML = `<div style="text-align:center; padding:15px 5px; color:#aaa; font-size:10px; line-height:1.4;">Nenhum atalho configurado para este documento.<br><br>Clique na <b>engrenagem</b> abaixo para criar ou vincular um modelo.</div>`;
                return;
            }

            const agrupado = {};
            perfilAtivo.regras.forEach(regra => {
                const cat = regra.category || 'Geral';
                if (!agrupado[cat]) agrupado[cat] =[];
                agrupado[cat].push(regra);
            });

            Object.keys(agrupado).sort().forEach(cat => {
                const headerCat = document.createElement('div');
                headerCat.className = 'tm-cat-header';
                headerCat.textContent = cat;
                containerDinamico.appendChild(headerCat);

                const boxBotoes = document.createElement('div');
                boxBotoes.className = 'tm-cat-container';

                agrupado[cat].forEach(regra => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'tm-botao tm-dinamico-btn';
                    btn.textContent = regra.name;
                    btn.title = regra.novo;

                    btn.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        processarAcaoNoEditor(regra.id);
                    });
                    boxBotoes.appendChild(btn);
                });
                containerDinamico.appendChild(boxBotoes);
            });
        }

        function atualizarDropdownPerfis() {
            selPerfil.innerHTML = '';
            perfisSalvos.forEach(p => {
                let opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.nome;
                selPerfil.appendChild(opt);
            });
            if (perfisSalvos.length > 0) {
                if (!perfilEditandoId || !perfisSalvos.find(p => p.id === perfilEditandoId)) {
                    perfilEditandoId = perfisSalvos[0].id;
                }
                selPerfil.value = perfilEditandoId;
                inKeywords.value = perfisSalvos.find(p => p.id === perfilEditandoId).keywords || '';
            } else {
                perfilEditandoId = null;
                inKeywords.value = '';
            }
            renderListaConfig();
        }

        const listaConfig = container.querySelector('#tm-lista-config');
        function renderListaConfig() {
            listaConfig.innerHTML = '';
            if (!perfilEditandoId) return;

            const perfilAtual = perfisSalvos.find(p => p.id === perfilEditandoId);
            if (!perfilAtual || !perfilAtual.regras) return;

            const regrasOrdenadas =[...perfilAtual.regras].sort((a, b) => (a.category || '').localeCompare(b.category || ''));

            regrasOrdenadas.forEach(regra => {
                const itemContainer = document.createElement('div');
                itemContainer.className = 'tm-config-list-item';

                const btnText = document.createElement('div');
                btnText.textContent = `[${regra.category || 'Geral'}] ${regra.name}`;
                btnText.className = 'tm-config-list-text';
                btnText.addEventListener('click', () => carregarFormulario(regra));

                const btnExcluir = document.createElement('button');
                btnExcluir.className = 'tm-config-list-del';
                btnExcluir.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                btnExcluir.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if(confirm(`Excluir o atalho "${regra.name}" deste modelo?`)) {
                        perfilAtual.regras = perfilAtual.regras.filter(r => r.id !== regra.id);
                        salvarPerfis();
                        renderListaConfig();
                        limparFormulario();
                    }
                });

                itemContainer.appendChild(btnText);
                itemContainer.appendChild(btnExcluir);
                listaConfig.appendChild(itemContainer);
            });
        }

        selPerfil.addEventListener('change', (e) => {
            perfilEditandoId = e.target.value;
            const p = perfisSalvos.find(x => x.id === perfilEditandoId);
            if (p) inKeywords.value = p.keywords || '';
            limparFormulario();
            renderListaConfig();
        });

        inKeywords.addEventListener('input', (e) => {
            if(!perfilEditandoId) return;
            const p = perfisSalvos.find(x => x.id === perfilEditandoId);
            if (p) {
                p.keywords = e.target.value;
                salvarPerfis();
            }
        });

        btnNovoPerfil.addEventListener('click', () => {
            let partes = document.title.split('-');
            let sugestaoNome = partes[partes.length - 1].trim();

            sugestaoNome = sugestaoNome.replace(/[0-9]/g, '').trim();
            sugestaoNome = sugestaoNome.replace(/^[-. ]+|[-. ]+$/g, '').replace(/\s+/g, ' ');

            if (!sugestaoNome || sugestaoNome.toLowerCase() === 'eproc') {
                sugestaoNome = "Modelo de Minuta";
            }

            const nome = prompt("Confirme o nome do novo Modelo de Minuta (Palavra-chave):", sugestaoNome);

            if (nome && nome.trim() !== '') {
                const novoPerfil = {
                    id: 'perfil_' + Date.now(),
                    nome: nome.trim(),
                    keywords: nome.trim(),
                    regras:[]
                };
                perfisSalvos.push(novoPerfil);
                perfilEditandoId = novoPerfil.id;
                salvarPerfis();
                atualizarDropdownPerfis();

                showToast("Modelo criado com sucesso!");
            }
        });

        btnExcluirPerfil.addEventListener('click', () => {
            if(!perfilEditandoId) return;
            const p = perfisSalvos.find(x => x.id === perfilEditandoId);
            if(confirm(`Tem certeza que deseja excluir todo o modelo "${p.nome}" e todos os seus atalhos?`)) {
                perfisSalvos = perfisSalvos.filter(x => x.id !== perfilEditandoId);
                salvarPerfis();
                atualizarDropdownPerfis();
            }
        });

        fab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fab.classList.add('tm-hidden'); painel.classList.add('tm-visible'); renderPainelPrincipal(); });
        btnMinimizar.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); painel.classList.remove('tm-visible'); fab.classList.remove('tm-hidden'); });
        btnDesfazer.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); desfazerUltimaAcao(); });

        btnOlho.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); modalDigitos.classList.add('tm-modal-active'); });
        modalDigitos.addEventListener('click', (e) => { if(e.target === modalDigitos) modalDigitos.classList.remove('tm-modal-active'); });

        btnAbrirConfig.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            atualizarDropdownPerfis();
            limparFormulario();
            modalConfig.classList.add('tm-modal-active');
        });

        function limparFormulario() {
            container.querySelector('#tm-cfg-id').value = '';
            container.querySelector('#tm-cfg-categoria').value = '';
            container.querySelector('#tm-cfg-nome').value = '';
            container.querySelector('#tm-cfg-alvo').value = '';
            container.querySelector('#tm-cfg-isregex').checked = false;
            container.querySelector('#tm-cfg-novo').value = '';
            container.querySelector('#tm-cfg-bold').checked = false;
            container.querySelector('#tm-cfg-italic').checked = false;
            container.querySelector('#tm-btn-excluir-regra').style.display = 'none';
        }

        function carregarFormulario(regra) {
            container.querySelector('#tm-cfg-id').value = regra.id;
            container.querySelector('#tm-cfg-categoria').value = regra.category || 'Geral';
            container.querySelector('#tm-cfg-nome').value = regra.name;
            container.querySelector('#tm-cfg-alvo').value = regra.target;
            container.querySelector('#tm-cfg-isregex').checked = regra.isRegex || false;
            container.querySelector('#tm-cfg-novo').value = regra.novo;
            container.querySelector('#tm-cfg-bold').checked = regra.bold || false;
            container.querySelector('#tm-cfg-italic').checked = regra.italic || false;
            container.querySelector('#tm-btn-excluir-regra').style.display = 'block';
        }

        container.querySelector('#tm-btn-add-novo').addEventListener('click', limparFormulario);

        container.querySelector('#tm-fechar-config').addEventListener('click', () => {
            modalConfig.classList.remove('tm-modal-active');
            detectarPerfilAtual();
            renderPainelPrincipal();
        });

        container.querySelector('#tm-btn-salvar-regra').addEventListener('click', () => {
            if(!perfilEditandoId) { showToast("Crie ou selecione um Modelo de Minuta primeiro!", true); return; }
            const p = perfisSalvos.find(x => x.id === perfilEditandoId);
            const targetVal = container.querySelector('#tm-cfg-alvo').value;
            if (!targetVal || targetVal.trim() === '') { showToast("O campo 'Texto Alvo' é obrigatório.", true); return; }

            const id = container.querySelector('#tm-cfg-id').value || 'regra_' + Date.now();
            const novaRegra = {
                id: id,
                category: container.querySelector('#tm-cfg-categoria').value || 'Geral',
                name: container.querySelector('#tm-cfg-nome').value || 'Novo Botão',
                target: targetVal,
                isRegex: container.querySelector('#tm-cfg-isregex').checked,
                novo: container.querySelector('#tm-cfg-novo').value || '',
                bold: container.querySelector('#tm-cfg-bold').checked,
                italic: container.querySelector('#tm-cfg-italic').checked,
                font: ''
            };

            const index = p.regras.findIndex(r => r.id === id);
            if (index !== -1) p.regras[index] = novaRegra;
            else p.regras.push(novaRegra);

            salvarPerfis();
            renderListaConfig();
            limparFormulario();
            showToast("✅ Atalho Salvo!");
        });

        container.querySelector('#tm-btn-excluir-regra').addEventListener('click', () => {
            const id = container.querySelector('#tm-cfg-id').value;
            if (id && perfilEditandoId) {
                const p = perfisSalvos.find(x => x.id === perfilEditandoId);
                p.regras = p.regras.filter(r => r.id !== id);
                salvarPerfis();
                renderListaConfig();
                limparFormulario();
            }
        });

        modalConfig.addEventListener('click', (e) => {
            if(e.target === modalConfig && !isCapturing) {
                modalConfig.classList.remove('tm-modal-active');
                detectarPerfilAtual();
                renderPainelPrincipal();
            }
        });

        renderPainelPrincipal();

        // Faz uma verificação de AJAX até 15 segundos para auto-abrir se os textos carregarem depois
        let checkCount = 0;
        const autoAbrirInterval = setInterval(() => {
            checkCount++;
            let estavaNulo = (perfilAtivo === null);
            detectarPerfilAtual();

            if (perfilAtivo) {
                clearInterval(autoAbrirInterval);
                if (estavaNulo) {
                    fab.classList.add('tm-hidden');
                    painel.classList.add('tm-visible');
                    renderPainelPrincipal();
                }
            } else if (checkCount >= 15) {
                clearInterval(autoAbrirInterval);
            }
        }, 1000);

        // ==========================================
        // 4. ESTILOS CSS
        // ==========================================
        GM_addStyle(`
            #tm-fab { position: fixed; bottom: 20px; right: 20px; width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(145deg, #383838, #000000); box-shadow: 0 8px 16px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.25), inset 0 -2px 4px rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999999; transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.2), opacity 0.4s ease, box-shadow 0.2s ease; }
            #tm-fab svg { color: #cccccc; transition: all 0.3s ease; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.8)); }
            #tm-fab:hover { transform: scale(1.08); box-shadow: 0 10px 20px rgba(0,0,0,0.6), inset 0 2px 4px rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.8); }
            #tm-fab:hover svg { color: #ffffff; filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.5)); }
            #tm-fab:active { transform: scale(0.92); box-shadow: 0 4px 8px rgba(0,0,0,0.5), inset 0 4px 6px rgba(0,0,0,0.9); }
            #tm-fab.tm-hidden { opacity: 0; transform: scale(0.2) rotate(-90deg); pointer-events: none; }

            #tm-painel-textos { position: fixed; bottom: 20px; right: 20px; background: rgba(25, 25, 25, 0.85); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 8px 8px 4px 8px; box-shadow: 0 16px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1); z-index: 9999998; display: flex; flex-direction: column; gap: 4px; width: max-content; min-width: 170px; max-width: 300px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; transform-origin: bottom right; opacity: 0; transform: scale(0.4) translateY(40px); pointer-events: none; transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15), opacity 0.4s ease; }
            #tm-painel-textos.tm-visible { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; }

            .tm-cat-header { font-size: 9.5px; font-weight: bold; color: #ccc; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; margin: 6px 0 2px 0; }
            .tm-cat-container { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; margin-bottom: 2px; }

            .tm-botao { background: linear-gradient(180deg, #3d3d3d 0%, #262626 100%); color: #eaeaea; border: 1px solid #111; border-top: 1px solid #555; padding: 4px 5px; border-radius: 5px; cursor: pointer; font-size: 8.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease; }
            .tm-botao:hover { background: linear-gradient(180deg, #4d4d4d 0%, #363636 100%); color: #ffffff; border-top: 1px solid #666; transform: translateY(-1px); box-shadow: 0 3px 6px rgba(0,0,0,0.5); }
            .tm-botao:active { background: #1e1e1e; border-top: 1px solid #111; transform: translateY(1px); box-shadow: none; }

            .tm-footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px; }
            .tm-btn-min, .tm-btn-acao { background-color: transparent; color: #888888; border: none; cursor: pointer; border-radius: 4px; transition: color 0.2s ease, background 0.2s ease, transform 0.2s ease; }
            .tm-btn-min { padding: 2px 4px; font-size: 7.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
            .tm-btn-acao { padding: 2px; display: flex; align-items: center; justify-content: center; }
            .tm-btn-min:hover, .tm-btn-acao:hover { color: #ffffff; background: rgba(255, 255, 255, 0.1); }
            .tm-btn-min:active, .tm-btn-acao:active { transform: scale(0.9); }

            .tm-config-list-item { display: flex; justify-content: space-between; align-items: stretch; background: linear-gradient(180deg, #3d3d3d 0%, #262626 100%); border: 1px solid #111; border-top: 1px solid #555; border-radius: 5px; margin-bottom: 4px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.4); }
            .tm-config-list-text { padding: 8px 10px; cursor: pointer; font-size: 12px; color: #eaeaea; font-weight: 500; flex: 1; display: flex; align-items: center; }
            .tm-config-list-text:hover { background: rgba(255,255,255,0.05); }
            .tm-config-list-del { background: rgba(220, 53, 69, 0.15); border: none; border-left: 1px solid #111; color: #ff6b6b; cursor: pointer; padding: 0 12px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
            .tm-config-list-del:hover { background: rgba(220, 53, 69, 0.8); color: #fff; }

            .tm-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10000000; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
            .tm-modal-overlay.tm-modal-active { opacity: 1; pointer-events: auto; }
            .tm-modal-content { background: rgba(30, 30, 32, 0.90); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 24px 32px; box-shadow: 0 24px 48px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05); transform: scale(0.90) translateY(15px); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15); color: #eaeaea; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; cursor: default; }
            .tm-modal-overlay.tm-modal-active .tm-modal-content { transform: scale(1) translateY(0); }
            .tm-modal-header { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #777; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; margin-bottom: 16px; text-align: center; font-weight: 700; }
            .tm-input { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px; width: 100%; outline: none; transition: border 0.2s ease; font-family: inherit; box-sizing: border-box; }
            .tm-input:focus { border: 1px solid rgba(255,255,255,0.4); }

            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }

            .tm-modal-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 4px; border-radius: 6px; transition: background 0.2s ease, transform 0.2s ease; }
            .tm-modal-row:nth-child(odd) { background: rgba(0, 0, 0, 0.25); }
            .tm-modal-row:nth-child(even) { background: rgba(255, 255, 255, 0.04); }
            .tm-modal-row:hover { background: rgba(255, 255, 255, 0.1); transform: scale(1.02); }
            .tm-label-dig { font-size: 11px; color: #a0a0a0; }
            .tm-modal-row .tm-label-dig { font-size: 13px; }
            .tm-nome { font-size: 14px; color: #f0f0f0; text-align: right; font-weight: 500; }
            .tm-badge { background: rgba(255, 255, 255, 0.15); color: #ffffff; padding: 2px 7px; border-radius: 4px; font-weight: 700; letter-spacing: 0.5px; margin-left: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); border: 1px solid rgba(255, 255, 255, 0.05); }
            .tm-modal-divider { margin: 20px 0 10px 0; padding: 6px 0; text-align: center; background: rgba(255,255,255,0.04); border-radius: 6px; border: 1px solid rgba(255,255,255,0.02); }
            .tm-title-bambui { font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #ffffff; font-weight: 700; }
        `);
    }

    // GATILHO DIRETO DA 6.3: Não trava se o documento não estiver 100% lido, abrindo na hora
    const verificarCarregamento = setInterval(() => {
        let win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (win.CKEDITOR && win.CKEDITOR.instances && Object.keys(win.CKEDITOR.instances).length > 0) {
            clearInterval(verificarCarregamento);
            criarInterface();
            iniciarMonitoramentoAutoX();
        }
    }, 1000);

})();