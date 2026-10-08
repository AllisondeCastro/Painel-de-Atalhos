// ==UserScript==
// @name         Painel de atalhos para minuta de Triagem EPROC
// @namespace    http://tampermonkey.net/
// @version      8.14
// @description  Dashboard Multi-Minutas
// @author       Allison de Castro Silva
// @match        https://eproc1g.tjmg.jus.br/eproc/controlador.php?acao=arvore_documento_listar*
// @match        https://eproc1g.tjmg.jus.br/eproc/controlador.php?acao=minuta_editar*
// @updateURL    https://github.com/AllisondeCastro/Painel-de-Atalhos/raw/refs/heads/main/Painel%20de%20atalhos%20para%20minuta%20de%20Triagem%20EPROC.user.js
// @downloadURL  https://github.com/AllisondeCastro/Painel-de-Atalhos/raw/refs/heads/main/Painel%20de%20atalhos%20para%20minuta%20de%20Triagem%20EPROC.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CFG_BRUTA = window.__TDOCS_TEST__;
  try { delete window.__TDOCS_TEST__; } catch (e) { try { window.__TDOCS_TEST__ = undefined; } catch (e2) {} }
  const CFG = Object.assign({}, CFG_BRUTA || {});

  function detectarPapel() {
    if (CFG.papel === 'arvore' || CFG.papel === 'minuta') return CFG.papel;
    const s = location.search || '';
    if (/(?:\?|&)acao=arvore_documento_listar(?:&|$)/.test(s)) return 'arvore';
    if (/(?:\?|&)acao=minuta_editar(?:&|$)/.test(s)) return 'minuta';
    return null;
  }

  const papel = detectarPapel();
  if (!papel) return;

  const tabId = CFG.tabId || (function () {
    let t = null;
    try { t = sessionStorage.getItem('eproc_triagem_tab'); } catch (e) {}
    if (!t) {
      t = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      try { sessionStorage.setItem('eproc_triagem_tab', t); } catch (e) {}
    }
    return t;
  })();

  if (window.__TDOCS_API__ && window.__TDOCS_API__[tabId]) return;

  // [REQUISITO] Roda mesmo se a tela estiver dentro de iframe. Para nao duplicar o console,
  // so desiste quando um documento ANCESTRAL (mesma origem) ja tem um console do MESMO papel.
  function temAncestroComMesmoPapel(p) {
    try {
      let w = window;
      while (w.parent && w.parent !== w) {
        w = w.parent;
        const d = w.document;
        if (d && d.querySelector('#dock[data-td-papel="' + p + '"]')) return true;
        if (w === w.top) break;
      }
    } catch (e) { /* origem diferente: nao da para inspecionar, entao roda */ }
    return false;
  }
  if (temAncestroComMesmoPapel(papel)) return;

  function somenteDigitos(v) { return (v || '').replace(/\D/g, ''); }

  function processoDaArvore() {
    if (CFG.proc) return somenteDigitos(CFG.proc);
    const m = (location.search || '').match(/[?&]txtNumProcesso=(\d+)/);
    if (m) return m[1];
    const el = document.getElementById('txtNumProcessoReduzido') || document.getElementById('txtNumProcesso');
    return el ? somenteDigitos(el.value) : '';
  }

  function processoDaMinuta() {
    if (CFG.proc) return somenteDigitos(CFG.proc);
    const m = (location.search || '').match(/[?&]num_processo=(\d+)/);
    if (m) return m[1];
    const el = document.getElementById('hdnNumProcessoLista');
    return el ? somenteDigitos(el.value) : '';
  }

  let procAtual = papel === 'arvore' ? processoDaArvore() : processoDaMinuta();

  const CHAVE_TAB = 'eproc_triagem_tab_';
  const CHAVE_BUS = 'eproc_triagem_bus';
  const CHAVE_DOCS = 'eproc_triagem_docs_';

  let bc = null;
  if (!CFG.semBC && typeof BroadcastChannel !== 'undefined') {
    try { bc = new BroadcastChannel('eproc_triagem'); } catch (e) { bc = null; }
  }

  function publicar(msg) {
    if (!bc) return;
    try { bc.postMessage(msg); } catch (e) {}
  }

  const abaAtual = { tipo: papel, proc: procAtual, foco: Date.now(), bate: Date.now() };

  function gravarAba() {
    try { localStorage.setItem(CHAVE_TAB + tabId, JSON.stringify(abaAtual)); } catch (e) {}
  }

  function listarAbas() {
    const agora = Date.now();
    const vivas = [];
    const velhas = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(CHAVE_TAB) !== 0 || k === CHAVE_TAB + tabId) continue;
      let v = null;
      try { v = JSON.parse(localStorage.getItem(k)); } catch (e) {}
      if (!v || !v.bate || agora - v.bate > 30000) { velhas.push(k); continue; }
      vivas.push({ id: k.slice(CHAVE_TAB.length), dados: v });
    }
    velhas.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    return vivas;
  }

  function alvoArvore(proc) {
    let melhor = null;
    listarAbas().forEach(function (a) {
      if (a.dados.tipo !== 'arvore' || a.dados.proc !== proc) return;
      if (!melhor || (a.dados.foco || 0) > (melhor.dados.foco || 0)) melhor = a;
    });
    return melhor ? melhor.id : null;
  }

  function chaveDocs(proc) { return CHAVE_DOCS + proc; }

  function gravarSnapshot(proc, docs) {
    if (CFG.semSnapshot || !proc) return;
    try { localStorage.setItem(chaveDocs(proc), JSON.stringify({ ts: Date.now(), docs: docs })); } catch (e) {}
  }

  function lerSnapshot(proc) {
    if (!proc) return null;
    try {
      const v = JSON.parse(localStorage.getItem(chaveDocs(proc)));
      return v && Array.isArray(v.docs) ? v.docs : null;
    } catch (e) { return null; }
  }

  let listaDocs = [];
  let docsPorProc = {};
  let procExibido = null;
  let expandManual = false;
  const estadoUI = { ultimoPedido: 0, ultimoDocs: 0, bloqueio: null };
  let aoMensagem = function () {};

  // [REQUISITO] Guarda os docs sempre por processo, para nunca misturar processos.
  function guardarDocs(proc, docs) {
    if (!proc) return;
    docsPorProc[proc] = { docs: Array.isArray(docs) ? docs : [], ts: Date.now() };
    const chaves = Object.keys(docsPorProc);
    if (chaves.length > 6) {
      chaves.sort(function (a, b) { return (docsPorProc[a].ts || 0) - (docsPorProc[b].ts || 0); });
      while (chaves.length > 6) { delete docsPorProc[chaves.shift()]; }
    }
  }

  // [REQUISITO] Sempre da prioridade ao processo atual; se nao houver, mantem o ultimo de outro processo (apenas para aviso).
  function aplicarDocsExibidos() {
    const proprio = docsPorProc[procAtual];
    if (proprio) {
      listaDocs = proprio.docs;
      procExibido = procAtual;
    } else {
      let melhor = null;
      Object.keys(docsPorProc).forEach(function (p) {
        if (p === procAtual) return;
        if (!melhor || (docsPorProc[p].ts || 0) > (docsPorProc[melhor].ts || 0)) melhor = p;
      });
      if (melhor) { listaDocs = docsPorProc[melhor].docs; procExibido = melhor; }
      else { listaDocs = []; procExibido = null; }
    }
    render();
    atualizarStatusDocs();
  }

  function minimizarDocs() {
    if (!dock) return;
    if (expandManual) return;
    dock.classList.add('sem-arvore');
    dock.classList.remove('recolhido');
    conectado = false;
  }

  // [REQUISITO] CNJ vermelho + tooltip quando os docs exibidos sao de outro processo.
  function atualizarStatusDocs() {
    const el = document.getElementById('td-status');
    if (!el) return;
    const mostra = procExibido || procAtual;
    const divergente = !!(procExibido && procAtual && procExibido !== procAtual);
    el.classList.toggle('divergente', divergente);
    const num = el.querySelector('.td-status-num');
    if (num) num.textContent = formatarCNJ(mostra);
    if (divergente) {
      el.title = '⚠ Os documentos exibidos são do processo ' + formatarCNJ(procExibido) +
        '. Você está minutando o processo ' + formatarCNJ(procAtual) +
        '. Abra a Árvore de documentos do processo que você está minutando.';
    } else {
      el.title = 'Processo ' + formatarCNJ(mostra);
    }
  }

  function receberDocs(docs, vivo, proc) {
    const p = proc || procAtual;
    if (!p) return;
    guardarDocs(p, docs);
    estadoUI.ultimoDocs = Date.now();
    cancelarColapsoPendente();
    aplicarDocsExibidos();
    if (procExibido === procAtual && vivo !== false) {
      expandManual = false;
      conectar();
    } else if (procExibido && procExibido !== procAtual) {
      minimizarDocs();
    }
  }

  // [REQUISITO] Se a mesma aba passar a representar outro processo, reinicia o vinculo e descarta docs antigos.
  function relerProcesso() {
    if (papel !== 'minuta') return;
    const p = processoDaMinuta();
    if (!p || p === procAtual) return;
    procAtual = p;
    abaAtual.proc = p;
    gravarAba();
    docsPorProc = {};
    procExibido = null;
    listaDocs = [];
    expandManual = false;
    ultimoJson = null;
    if (dock) dock.classList.add('sem-arvore');
    conectado = false;
    render();
    atualizarStatusDocs();
    enviarPedido();
  }

  function enviarPedido() {
    if (!procAtual) return;
    const msg = { tipo: 'pedido', de: tabId, alvo: alvoArvore(procAtual), proc: procAtual, ts: Date.now() };
    estadoUI.ultimoPedido = msg.ts;
    publicar(msg);
    try { localStorage.setItem(CHAVE_BUS, JSON.stringify(msg)); } catch (e) {}
  }

  let ultimoJson = null;

  function enviarMarcarDoc(id) {
    if (!procAtual || !id) return false;
    const msg = { tipo: 'marcarDoc', de: tabId, proc: procAtual, id: id, ts: Date.now() };
    publicar(msg);
    try { localStorage.setItem(CHAVE_BUS, JSON.stringify(msg)); } catch (e) {}
    return true;
  }

  function enviarDocsAgora() {
    if (!procAtual) return;
    estadoUI.ultimoDocs = Date.now();
    gravarSnapshot(procAtual, listaDocs);
    publicar({ tipo: 'docs', de: tabId, proc: procAtual, ts: Date.now(), docs: listaDocs });
  }

  function publicarSeMudou(docs) {
    const j = JSON.stringify(docs);
    if (j === ultimoJson) return false;
    ultimoJson = j;
    listaDocs = docs;
    enviarDocsAgora();
    return true;
  }

  window.addEventListener('storage', function (ev) {
    const k = ev.key;
    if (!k) return;
    if (k === CHAVE_BUS) {
      let msg = null;
      try { msg = JSON.parse(ev.newValue); } catch (e) {}
      if (msg) aoMensagem(msg);
      return;
    }
    if (papel === 'minuta' && k.indexOf(CHAVE_DOCS) === 0) {
      let v = null;
      try { v = JSON.parse(ev.newValue); } catch (e) {}
      if (v && Array.isArray(v.docs)) receberDocs(v.docs, true, k.slice(CHAVE_DOCS.length));
    }
  });

  if (bc) {
    bc.onmessage = function (ev) {
      if (ev && ev.data) aoMensagem(ev.data);
    };
  }

  function aoFocar() {
    abaAtual.foco = Date.now();
    if (procAtual) gravarAba();
    if (papel === 'arvore') {
      const docs = extrairDocs();
      if (docs.length) publicarSeMudou(docs);
    }
  }

  window.addEventListener('focus', aoFocar);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) aoFocar();
  });

  setInterval(function () {
    abaAtual.bate = Date.now();
    if (procAtual) gravarAba();
  }, 5000);

  window.addEventListener('pagehide', function () {
    try { localStorage.removeItem(CHAVE_TAB + tabId); } catch (e) {}
  });

  window.addEventListener('pageshow', function (ev) {
    if (ev && ev.persisted) {
      abaAtual.bate = Date.now();
      if (procAtual) gravarAba();
    }
  });

  if (procAtual) gravarAba();

  function extrairDocs() {
    if (CFG.docsFixo) return CFG.docsFixo.slice();
    const raiz = document.getElementById('divArvore');
    if (!raiz) return [];
    const lis = raiz.querySelectorAll('li[seqdoc]');
    const docs = [];
    for (let i = 0; i < lis.length; i++) {
      const li = lis[i];
      if (li.id === 'capa') continue;
      const spans = li.querySelectorAll('div[id^="widgetlinkdocumento4"] > span.widgetlinkdocumento');
      let span = null;
      for (let j = 0; j < spans.length; j++) {
        if (spans[j].closest('li') === li) { span = spans[j]; break; }
      }
      if (!span) continue;
      let idDoc = li.id && li.id.indexOf('-') !== -1 ? li.id.split('-')[0] : span.getAttribute('data-iddocumento');
      if (!idDoc) continue;
      let label = '';
      let fonteNome = false;
      const nome = li.querySelector('[id^="eventoDocumento_"]');
      if (nome) label = (nome.getAttribute('aria-label') || '').trim();
      if (label) fonteNome = true;
      if (!label) {
        const spn = li.querySelector('[id^="spnEventoDocumento_"]');
        if (spn) label = (spn.textContent || '').trim().replace(/\s*Copiar link para documento.*$/i, '');
        if (label) fonteNome = true;
      }
      if (!label) label = (span.textContent || '').trim();
      if (!label) continue;
      const html = span.outerHTML.replace(/data-mimetype="pdf"/, 'data-mimetype="pdf" data-page="1"');
      docs.push({ seq: docs.length + 1, label: label, html: html, idDocumento: idDoc, fonteNome: fonteNome });
    }
    return docs;
  }

  function marcarNaArvore(idDoc) {
    if (!idDoc) return;
    const raiz = document.getElementById('divArvore');
    if (!raiz) return;
    const alvo = String(idDoc).trim();
    const lis = raiz.querySelectorAll('li[seqdoc]');
    for (let i = 0; i < lis.length; i++) {
      const li = lis[i];
      if (li.id === 'capa') continue;
      const prefixo = li.id ? li.id.split('-')[0] : '';
      if (prefixo !== alvo) continue;
      if (li.classList.contains('jstree-checked')) return;
      const ck = li.querySelector('i.jstree-checkbox');
      if (ck) ck.click();
      return;
    }
  }

  function iniciarProvedor() {
    let tentativas = 0;
    const limite = CFG.tempoCurto ? 100 : 75;

    function tentarPublicar() {
      tentativas++;
      const docs = extrairDocs();
      if (docs.length === 0 && tentativas < limite && !CFG.docsFixo) return false;
      publicarSeMudou(docs);
      if (docs.length === 0) return true;
      if (CFG.docsFixo) return true;
      if (docs.every(function (d) { return d.fonteNome; })) return true;
      if (tentativas < limite) return false;
      return true;
    }

    aoMensagem = function (msg) {
      if (!msg || !procAtual) return;
      abaAtual.bate = Date.now();
      gravarAba();
      if (msg.tipo === 'marcarDoc') {
        if (msg.proc === procAtual && msg.id) marcarNaArvore(msg.id);
        return;
      }
      if (msg.tipo !== 'pedido' || !procAtual) return;
      if (msg.proc !== procAtual) return;
      if (msg.alvo && msg.alvo !== tabId) return;
      if (ultimoJson === null) return;
      enviarDocsAgora();
    };

    // [REQUISITO] Ao abrir, a arvore se anuncia para que a minuta do mesmo processo peça os docs na hora.
    if (procAtual) {
      try { publicar({ tipo: 'arvoreAberta', de: tabId, proc: procAtual, ts: Date.now() }); } catch (e) {}
    }

    setTimeout(function () {
      if (tentarPublicar()) return;
      const iv = setInterval(function () {
        if (tentarPublicar()) clearInterval(iv);
      }, CFG.tempoCurto ? 150 : 400);
    }, CFG.atrasoExtracao || 0);
  }

  function toast(msg, erro) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: ' +
      (erro ? 'rgba(220, 53, 69, 0.95)' : 'rgba(40, 167, 69, 0.95)') +
      '; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 99999999; opacity: 0; transition: opacity 0.3s, bottom 0.3s; pointer-events: none; font-family: sans-serif; text-align: center; max-width: 80%;';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '1'; t.style.bottom = '90px'; }, 10);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.bottom = '80px';
      setTimeout(function () { t.remove(); }, 300);
    }, 3000);
  }

  function obterEditorValido() {
    if (!window.CKEDITOR || !window.CKEDITOR.instances) return null;
    if (typeof window.current_editor === 'function' && window.current_editor()) {
      const ativo = window.CKEDITOR.instances[window.current_editor()];
      if (ativo && !ativo.readOnly) return ativo;
    }
    for (const k in window.CKEDITOR.instances) {
      const ed = window.CKEDITOR.instances[k];
      if (ed && !ed.readOnly) return ed;
    }
    return null;
  }

  const perfisPadrao = [
    {
      id: 'perfil_triagem',
      nome: 'Certidão de Triagem',
      keywords: 'Certidão de Triagem',
      regras: [
        { id: 'item3_rg', category: '3 RG', name: '10 anos', target: '( ) Desatualizado/inexistente/desconforme -', isRegex: false, novo: '( X ) desatualizado. Emitido em período superior a 10 anos da distribuição da ação - ', bold: true, italic: false, font: '' },
        { id: 'item4_residencia180', category: '4 Endereço', name: '180 dias', target: '( ) insuficiente (desatualizado e/ou em nome de 3º sem comprovação) -', isRegex: false, novo: '(  X  ) desatualizado. Datado de período superior a 180 dias da distribuição da ação - ', bold: true, italic: false, font: '' },
        { id: 'item4_inexistente', category: '4 Endereço', name: 'Inexistente', target: '( ) insuficiente (desatualizado e/ou em nome de 3º sem comprovação) -', isRegex: false, novo: '( X ) Inexistente. Comprovante de endereço, em nome da parte autora, ou de pessoa com quem comprove vínculo, datado de ao menos 180 dias da distribuição da demanda, podendo ser contas de luz ou água, boletos de contas bancárias, fatura de cartão de crédito, plano de saúde, tv por assinatura, streaming, linhas de celular. ', bold: true, italic: false, font: '' },
        { id: 'item4_insuficiente', category: '4 Endereço', name: 'Insuficiente', target: '( ) insuficiente (desatualizado e/ou em nome de 3º sem comprovação) -', isRegex: false, novo: '( X ) insuficiente. Comprovante de endereço, em nome da parte autora, ou de pessoa com quem comprove vínculo, datado de ao menos 180 dias da distribuição da demanda, podendo ser contas de luz ou água, boletos de contas bancárias, fatura de cartão de crédito, plano de saúde, tv por assinatura, streaming, linhas de celular - ', bold: true, italic: false, font: '' },
        { id: 'item5_digital', category: '5 Assinatura', name: 'Digital', target: '(   ) desconforme –  Motivo:', isRegex: false, novo: '( X ) desconforme. Motivo: não foi possível certificar a autenticidade da assinatura digital -  \n', bold: true, italic: false, font: '' },
        { id: 'regra_1773139643710', category: '5 Assinatura', name: '1 Ano', target: '(   ) desconforme –  Motivo:', isRegex: false, novo: '( X ) Desconforme. Motivo: documento datado superior a um ano da distribuição da demanda. - ', bold: true, italic: false, font: '' },
        { id: 'item3_assinatura', category: '5 Assinatura', name: 'Assin. Divergente', target: '(   ) desconforme –  Motivo:', isRegex: false, novo: '( X ) insuficiente. assinatura diverge do documento de identificação juntado aos autos - ', bold: true, italic: false, font: '' },
        { id: 'regra_1773829306382', category: '6 AJG', name: 'SEM Rendimentos', target: '(   ) há pedido de AJG sem comprovação de rendimentos', isRegex: false, novo: '(  X ) há pedido de AJG sem comprovação de rendimentos.', bold: true, italic: false, font: '' }
      ]
    }
  ];

  const CHAVE_PERFIS = 'tm_eproc_perfis_v6';

  // [REVERSIVEL] Le qualquer chave de perfis (aceita array ou modelo unico), filtrando entradas invalidas.
  function lerListaPerfis(chave) {
    try {
      const bruto = localStorage.getItem(chave);
      if (!bruto) return null;
      let v = JSON.parse(bruto);
      if (v && !Array.isArray(v) && v.nome) v = [v];
      if (!Array.isArray(v)) return null;
      const limpos = v.filter(function (p) { return p && typeof p === 'object' && p.nome; });
      return limpos.length ? limpos : null;
    } catch (e) { return null; }
  }

  // [COMPATIBILIDADE] Procuras chaves de modelos gravadas por versoes/scripts anteriores.
  function chavesPerfisAnteriores() {
    const chaves = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k === CHAVE_PERFIS) continue;
        const baixo = k.toLowerCase();
        if (baixo.indexOf('perfis') === -1) continue;
        if (baixo.indexOf('eproc') === -1 && baixo.indexOf('atalho') === -1 && baixo.indexOf('triagem') === -1 &&
            baixo.indexOf('minuta') === -1 && baixo.indexOf('painel') === -1) continue;
        chaves.push(k);
      }
    } catch (e) {}
    return chaves;
  }

  // [COMPATIBILIDADE] Acrescenta modelos/atalhos ausentes SEM sobrescrever os ja salvos.
  function mesclarPerfisSalvos(base, entrada) {
    let mudou = false;
    (entrada || []).forEach(function (p) {
      if (!p || !p.nome) return;
      const id = p.id || ('perfil_' + String(p.nome).replace(/[^a-z0-9]+/gi, '_').toLowerCase());
      let atual = null;
      for (let i = 0; i < base.length; i++) { if (base[i] && base[i].id === id) { atual = base[i]; break; } }
      if (!atual) {
        base.push({ id: id, nome: p.nome, keywords: p.keywords || '', regras: Array.isArray(p.regras) ? p.regras.slice() : [] });
        mudou = true;
        return;
      }
      const existentes = Array.isArray(atual.regras) ? atual.regras : (atual.regras = []);
      (Array.isArray(p.regras) ? p.regras : []).forEach(function (r) {
        if (!r) return;
        const dup = existentes.some(function (e) {
          if (!e) return false;
          if (e.id && r.id) return e.id === r.id;
          return e.target === r.target && e.name === r.name;
        });
        if (!dup) { existentes.push(Object.assign({}, r)); mudou = true; }
      });
    });
    return mudou;
  }

  let perfisSalvos = [];
  (function carregarPerfis() {
    const atual = lerListaPerfis(CHAVE_PERFIS);
    const anteriores = [];
    chavesPerfisAnteriores().forEach(function (k) {
      const lista = lerListaPerfis(k);
      if (lista) anteriores.push(lista);
    });
    let mudou = false;
    if (atual) {
      perfisSalvos = atual;
    } else if (anteriores.length) {
      perfisSalvos = anteriores.shift();
      mudou = true;
    } else {
      perfisSalvos = perfisPadrao;
    }
    anteriores.forEach(function (lista) {
      if (mesclarPerfisSalvos(perfisSalvos, lista)) mudou = true;
    });
    if (!Array.isArray(perfisSalvos) || perfisSalvos.length === 0) perfisSalvos = perfisPadrao;
    if (mudou) { try { localStorage.setItem(CHAVE_PERFIS, JSON.stringify(perfisSalvos)); } catch (e) {} }
  })();

  let perfilAtivo = null;
  let perfilEditandoId = null;

  function salvarPerfis() {
    try { localStorage.setItem(CHAVE_PERFIS, JSON.stringify(perfisSalvos)); } catch (e) {}
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
    const titulo = document.title || '';
    const textosHeader = [];
    const elementos = document.querySelectorAll('#lblInfraDescricaoTela, .infraAreaTelaDsc, #selTipoDocumento, #txtDescricao, #txtNomeDocumento, #txtNomeMinuta');
    for (let i = 0; i < elementos.length; i++) {
      const el = elementos[i];
      if (el.tagName && el.tagName.toLowerCase() === 'select') {
        if (el.selectedIndex >= 0 && el.options[el.selectedIndex]) textosHeader.push(el.options[el.selectedIndex].text);
      } else {
        textosHeader.push(el.textContent || el.value || '');
      }
    }
    const textoBusca = (titulo + ' ' + textosHeader.join(' ')).replace(/\s+/g, ' ');
    perfilAtivo = null;
    for (let i = 0; i < perfisSalvos.length; i++) {
      const p = perfisSalvos[i];
      if (!p.keywords) continue;
      const chaves = p.keywords.split(',').map(function (k) { return traduzirKeywordParaEproc(k).trim(); }).filter(function (k) { return k; });
      for (let c = 0; c < chaves.length; c++) {
        try {
          if (new RegExp(chaves[c], 'i').test(textoBusca)) { perfilAtivo = p; break; }
        } catch (e) {}
      }
      if (perfilAtivo) break;
    }
  }

  function construirRegexInteligente(textoPlano) {
    let str = textoPlano.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    str = str.replace(/\\\([\s\xA0Xx\u00A0]*\\\)/g, '\\(\\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\\s)*\\s*\\)');
    str = str.replace(/[\s\xA0\u00A0]+/g, '(?:<[^>]*>|&nbsp;|&#160;|\\s)+');
    str = str.replace(/[áàãâäéèêëíìîïóòõôöúùûüçºª\-\–\—]/gi, '(?:<[^>]*>)*(?:&[a-zA-Z0-9#]+;|[\\s\\S])(?:<[^>]*>)*');
    return str;
  }

  function normalizarTexto(s) {
    return String(s || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function contarOcorrencias(texto, re) {
    if (!texto || !re) return 0;
    let n = 0;
    try {
      re.lastIndex = 0;
      while (re.exec(texto) !== null) {
        n++;
        if (n > 500) break;
      }
      re.lastIndex = 0;
    } catch (e) {}
    return n;
  }

  function contarAplicadasAnteriores(regra, textoNorm) {
    const posicao = Number(regra.ocorrencia) || 0;
    if (posicao < 1) return 0;
    let n = 0;
    perfisSalvos.forEach(function (p) {
      const rs = p.regras || [];
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        if (r.target !== regra.target) continue;
        if (!!r.isRegex !== !!regra.isRegex) continue;
        const occ = Number(r.ocorrencia) || 0;
        if (occ < 1 || occ >= posicao) continue;
        const rn = normalizarTexto(r.novo);
        if (rn.length < 10) continue;
        if (textoNorm.indexOf(rn) !== -1) n++;
      }
    });
    return n;
  }

  function processarAcaoNoEditor(regraId) {
    if (!perfilAtivo) return;
    const regraEncontrada = perfilAtivo.regras.find(function (r) { return r.id === regraId; });
    if (!regraEncontrada) return;
    const editor = obterEditorValido();
    if (!editor) {
      toast('Editor editável não encontrado. Aguarde o carregamento.', true);
      return;
    }
    const sx = window.scrollX;
    const sy = window.scrollY;
    const body = editor.document.getBody();
    let foiSubstituido = false;
    let textoInsercao = String(regraEncontrada.novo || '').replace(/\r?\n/g, '<br>');
    if (regraEncontrada.italic) textoInsercao = '<em>' + textoInsercao + '</em>';
    if (regraEncontrada.bold) textoInsercao = '<strong>' + textoInsercao + '</strong>';
    if (regraEncontrada.underline) textoInsercao = '<u>' + textoInsercao + '</u>';
    if (regraEncontrada.font) textoInsercao = '<span style="font-family: ' + regraEncontrada.font + ';">' + textoInsercao + '</span>';
    let regexStr;
    if (regraEncontrada.isRegex) regexStr = regraEncontrada.target;
    else regexStr = construirRegexInteligente(regraEncontrada.target);
    let targetRegex;
    let targetRegexG;
    try {
      targetRegex = new RegExp(regexStr, 'i');
      targetRegexG = new RegExp(regexStr, 'gi');
    }
    catch (e) {
      toast('Expressão Regular inválida no botão \'' + regraEncontrada.name + '\'.', true);
      return;
    }
    let replaceCount = 0;
    const baseId = 'tm-cursor-' + Date.now();
    const selecao = editor.getSelection();
    let bookmarks = null;
    if (selecao) {
      try { bookmarks = selecao.createBookmarks(); } catch (e) {}
    }
    const htmlMarcado = body.getHtml();
    const bmRegex = /<span[^>]*data-cke-bookmark[^>]*>.*?<\/span>/i;
    const partes = htmlMarcado.split(bmRegex);
    const antes = partes[0] || '';
    const depois = partes.length > 1 ? partes.slice(1).join('') : '';
    const bmTag = htmlMarcado.match(bmRegex) ? htmlMarcado.match(bmRegex)[0] : '';
    const tagsFinais = function (match) {
      const m = /(?:<[^>]*>)+$/.exec(match);
      return m ? m[0] : '';
    };
    const tagsIniciais = function (match) {
      const m = /^(?:<[^>]*>)+/.exec(match);
      return m ? m[0] : '';
    };
    const aplicar = function (parte) {
      let trocou = false;
      return parte.replace(targetRegex, function () {
        if (trocou) return arguments[0];
        trocou = true;
        foiSubstituido = true;
        replaceCount++;
        return tagsIniciais(arguments[0]) + textoInsercao + '<span id="' + baseId + '-' + replaceCount + '"></span>' + tagsFinais(arguments[0]);
      });
    };
    const substituirKesima = function (parte, k) {
      let n = 0;
      return parte.replace(targetRegexG, function () {
        n++;
        if (n !== k) return arguments[0];
        foiSubstituido = true;
        replaceCount++;
        return tagsIniciais(arguments[0]) + textoInsercao + '<span id="' + baseId + '-' + replaceCount + '"></span>' + tagsFinais(arguments[0]);
      });
    };
    const ocorrenciaDesejada = Number(regraEncontrada.ocorrencia) || 0;
    const posicional = ocorrenciaDesejada > 0;
    editor.fire('saveSnapshot');
    let novoAntes = antes;
    let novoDepois = depois;
    if (posicional) {
      const compensacao = contarAplicadasAnteriores(regraEncontrada, normalizarTexto(htmlMarcado));
      const k = ocorrenciaDesejada - compensacao;
      const totalAntes = contarOcorrencias(antes, targetRegexG);
      const totalDepois = contarOcorrencias(depois, targetRegexG);
      const total = totalAntes + totalDepois;
      if (k < 1 || k > total) {
        if (selecao && bookmarks) {
          try { selecao.selectBookmarks(bookmarks); } catch (e) {}
        }
        toast('⚠️ A posição ' + ocorrenciaDesejada + ' do texto alvo não está disponível na minuta (ocorrências livres: ' + total + ').', true);
        editor.fire('saveSnapshot');
        try { window.scrollTo(sx, sy); } catch (e) {}
        return;
      }
      if (k <= totalAntes) novoAntes = substituirKesima(antes, k);
      else novoDepois = substituirKesima(depois, k - totalAntes);
    } else {
      novoDepois = aplicar(depois);
      if (!foiSubstituido) novoAntes = aplicar(antes);
    }
    if (foiSubstituido) {
      body.setHtml(novoAntes + bmTag + novoDepois);
      const primeiro = editor.document.getById(baseId + '-1');
      if (primeiro) {
        const range = editor.createRange();
        const pos = (window.CKEDITOR && window.CKEDITOR.POSITION_BEFORE_START) ? window.CKEDITOR.POSITION_BEFORE_START : 1;
        range.moveToPosition(primeiro, pos);
        if (selecao) {
          try { selecao.selectRanges([range]); }
          catch (e) { try { range.select(); } catch (e2) {} }
        } else {
          try { range.select(); } catch (e) {}
        }
      } else if (selecao && bookmarks) {
        try { selecao.selectBookmarks(bookmarks); } catch (e) {}
      }
      for (let i = 1; i <= replaceCount; i++) {
        const m = editor.document.getById(baseId + '-' + i);
        if (m) m.remove();
      }
      editor.focus();
    } else {
      if (selecao && bookmarks) {
        try { selecao.selectBookmarks(bookmarks); } catch (e) {}
      }
      toast('⚠️ O \'Texto Alvo\' não foi encontrado na minuta.', true);
    }
    editor.fire('saveSnapshot');
    try { window.scrollTo(sx, sy); } catch (e) {}
  }

  function desfazerUltimaAcao() {
    const editor = obterEditorValido();
    if (editor && editor.execCommand) editor.execCommand('undo');
  }

  function temRange(sel) {
    if (!sel) return false;
    try {
      const r = sel.getRanges();
      return !!(r && r.length && r[0]);
    } catch (e) { return false; }
  }

  function garantirSelecao(ed, tinhaSel) {
    let sel = null;
    try { sel = ed.getSelection(); } catch (e) {}
    if (tinhaSel && temRange(sel)) return;
    try {
      const range = ed.createRange();
      const pos = (window.CKEDITOR && typeof window.CKEDITOR.POSITION_BEFORE_END !== 'undefined') ? window.CKEDITOR.POSITION_BEFORE_END : 3;
      range.moveToPosition(ed.document.getBody(), pos);
      if (sel) {
        try { sel.selectRanges([range]); return; } catch (e) {}
      }
      try { range.select(); } catch (e) {}
    } catch (e) {}
  }

  function inserirComBookmarks(ed, html) {
    let sel = null;
    try { sel = ed.getSelection(); } catch (e) {}
    let bm = null;
    if (sel) {
      try { bm = sel.createBookmarks(); } catch (e) {}
    }
    const body = ed.document.getBody();
    const h = body.getHtml();
    const re = /<span[^>]*data-cke-bookmark[^>]*>.*?<\/span>/i;
    const m = re.exec(h);
    if (m) {
      body.setHtml(h.slice(0, m.index) + html + h.slice(m.index));
    } else {
      body.setHtml(h + html);
    }
    if (sel && bm) {
      try { sel.selectBookmarks(bm); } catch (e) {}
    }
  }

  function alvoIdDoc(doc) {
    if (doc.idDocumento) return doc.idDocumento;
    const m = /data-iddocumento="([^"]+)"/.exec(doc.html || '');
    return m ? m[1] : null;
  }

  function contarIdDoc(ed, id) {
    let h = '';
    try { h = ed.document.getBody().getHtml(); } catch (e) { return 0; }
    const alvo = 'data-iddocumento="' + id + '"';
    let c = 0;
    let i = 0;
    while ((i = h.indexOf(alvo, i)) !== -1) { c++; i += alvo.length; }
    return c;
  }

  function ultimoTextoAntes(startNode, off) {
    let n = startNode && (startNode.$ || startNode);
    let o = off;
    for (let passo = 0; passo < 16 && n; passo++) {
      if (n.nodeType === 3) {
        if (o > 0) return (n.data || '').slice(0, o);
        const p = n.parentNode;
        if (!p || !p.childNodes) return null;
        let idx = -1;
        for (let k = 0; k < p.childNodes.length; k++) { if (p.childNodes[k] === n) { idx = k; break; } }
        if (idx < 0) return null;
        n = p;
        o = idx;
        continue;
      }
      if (n.nodeType === 1) {
        if (o > 0) {
          let c = n.childNodes[o - 1];
          if (!c) return null;
          while (c && c.nodeType !== 3) {
            if (!c.lastChild) return null;
            c = c.lastChild;
          }
          return c ? (c.data || '') : null;
        }
        const p = n.parentNode;
        if (!p || !p.childNodes) return null;
        let idx = -1;
        for (let k = 0; k < p.childNodes.length; k++) { if (p.childNodes[k] === n) { idx = k; break; } }
        if (idx < 0) return null;
        n = p;
        o = idx;
        continue;
      }
      return null;
    }
    return null;
  }

  function precisaEspacoAntes(ed) {
    try {
      let sel = null;
      try { sel = ed.getSelection(); } catch (e) {}
      if (!sel) return true;
      let r = null;
      try { const rr = sel.getRanges(); r = rr && rr.length ? rr[0] : null; } catch (e) {}
      if (!r || !r.startContainer) return true;
      const txt = ultimoTextoAntes(r.startContainer, r.startOffset);
      if (txt === null || txt === '') return false;
      return !/[\s\u00A0]/.test(txt.charAt(txt.length - 1));
    } catch (e) { return true; }
  }

  function localizarInserido(h, htmlAntes, alvo, n) {
    let p = 0;
    const lim = Math.min(htmlAntes ? htmlAntes.length : 0, h.length);
    while (p < lim && htmlAntes.charCodeAt(p) === h.charCodeAt(p)) p++;
    const i = h.indexOf(alvo, p);
    if (i >= 0) return i;
    if (typeof n === 'number' && n >= 0) {
      let j = 0;
      let c = 0;
      while ((j = h.indexOf(alvo, j)) !== -1) {
        if (c === n) return j;
        c++;
        j += alvo.length;
      }
    }
    return -1;
  }

  function acharCheckbox(h, ini, fim) {
    const re = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\s)*\)/g;
    let m;
    let achado = null;
    re.lastIndex = 0;
    while ((m = re.exec(h)) !== null) {
      if (m.index >= fim) break;
      const fimM = m.index + m[0].length;
      if (fimM > fim) continue;
      if (m.index < ini) continue;
      if (h.lastIndexOf('<', m.index) > h.lastIndexOf('>', m.index)) continue;
      achado = { ini: m.index, fim: fimM, marcado: /[Xx]/.test(m[0].replace(/<[^>]*>/g, '')) };
    }
    return achado;
  }

  function ehGuardaCheckbox(h, fimMatch) {
    try {
      const dep = h.slice(fimMatch, fimMatch + 120);
      return /^\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|\s)*(?:N[ãa]o|Sim|desconforme)\b/i.test(dep);
    } catch (e) { return false; }
  }

  function procurarCheckboxAnterior(h, lim) {
    const reSep = /<br\s*\/?>|<\/?p\b[^>]*>|<\/?div\b[^>]*>|<\/?li\b[^>]*>|<\/?td\b[^>]*>|<\/?h[1-6]\b[^>]*>|<\/?tr\b[^>]*>|<\/?ul\b[^>]*>|<\/?ol\b[^>]*>/gi;
    const runs = [];
    let pos = 0;
    let m;
    while ((m = reSep.exec(h)) !== null) {
      if (m.index > pos) runs.push({ ini: pos, fim: m.index });
      pos = m.index + m[0].length;
    }
    if (pos < h.length) runs.push({ ini: pos, fim: h.length });
    let atual = -1;
    for (let i = 0; i < runs.length; i++) {
      if (lim >= runs[i].ini && lim <= runs[i].fim) { atual = i; break; }
    }
    if (atual < 0) return null;
    const noAtual = acharCheckbox(h, runs[atual].ini, lim);
    if (noAtual) return noAtual;
    let vistas = 0;
    for (let i = atual - 1; i >= 0 && vistas < 3; i--) {
      const r = runs[i];
      const bruto = h.slice(r.ini, r.fim);
      const vis = bruto.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&#160;/gi, ' ').trim();
      if (!vis) continue;
      vistas++;
      if (/^\s*\d{1,2}(?:[.\-]\d+)*[.)]/.test(vis)) return null;
      const achado = acharCheckbox(h, r.ini, r.fim);
      if (achado) return achado;
    }
    return null;
  }

  function marcarCheckboxAposInserir(ed, id, htmlAntes, ocorrenciasAntes) {
    let body = null;
    try { body = ed.document.getBody(); } catch (e) { return false; }
    if (!body) return false;
    const alvo = 'data-iddocumento="' + id + '"';
    let h = '';
    try { h = body.getHtml(); } catch (e) { return false; }
    let idx = localizarInserido(h, htmlAntes, alvo, ocorrenciasAntes);
    if (idx < 0) return false;
    let iniMarca = h.lastIndexOf('<', idx);
    if (iniMarca < 0) iniMarca = 0;
    let cand = procurarCheckboxAnterior(h, iniMarca);
    if (!cand || cand.marcado || ehGuardaCheckbox(h, cand.fim)) return false;
    let sel = null;
    try { sel = ed.getSelection(); } catch (e) {}
    let bm = null;
    if (sel && temRange(sel)) {
      try { bm = sel.createBookmarks(); } catch (e) {}
    }
    try { h = body.getHtml(); } catch (e) {}
    idx = localizarInserido(h, htmlAntes, alvo, ocorrenciasAntes);
    if (idx >= 0) {
      iniMarca = h.lastIndexOf('<', idx);
      if (iniMarca < 0) iniMarca = 0;
      cand = procurarCheckboxAnterior(h, iniMarca);
    }
    if (!cand || cand.marcado || ehGuardaCheckbox(h, cand.fim)) {
      if (sel && bm) { try { sel.selectBookmarks(bm); } catch (e) {} }
      return false;
    }
    body.setHtml(h.slice(0, cand.ini) + '( X )' + h.slice(cand.fim));
    if (sel && bm) { try { sel.selectBookmarks(bm); } catch (e) {} }
    return true;
  }

  function posicionarCursorAposLink(ed, id, ocorrencia) {
    try {
      if (!ed || !id) return;
      const ck = window.CKEDITOR;
      const T_NODE = (ck && ck.NODE_TEXT) || 3;
      const E_NODE = (ck && ck.NODE_ELEMENT) || 1;
      const body2 = ed.document.getBody();
      let el = null;
      try {
        const lista = body2.find('[data-iddocumento="' + id + '"]');
        if (lista && typeof lista.count === 'function' && lista.count() > 0) {
          let i = (typeof ocorrencia === 'number' && ocorrencia >= 0) ? ocorrencia : 0;
          if (i >= lista.count()) i = lista.count() - 1;
          el = lista.getItem(i);
        }
      } catch (e) {}
      if (!el) {
        try { el = body2.findOne('[data-iddocumento="' + id + '"]'); } catch (e) {}
      }
      if (!el) return;
      const rng = ed.document.createRange();
      const aplicar = function (node, off, after) {
        try {
          if (after) rng.setStartAfter(node); else rng.setStart(node, off);
          rng.collapse(true);
          const sel2 = ed.getSelection();
          if (sel2) { sel2.removeAllRanges(); sel2.selectRanges([rng]); }
          return true;
        } catch (e) { return false; }
      };
      let nodo = el;
      for (let i = 0; i < 20; i++) {
        let prox = null;
        try { prox = nodo.getNext(); } catch (e) { prox = null; }
        if (!prox) break;
        const tp = prox.type;
        if (tp === T_NODE) {
          let t = '';
          try { t = prox.getText() || ''; } catch (e) { t = ''; }
          if (t.charAt(0) === ' ') {
            if (aplicar(prox, 1, false)) return;
          } else if (t.length > 0) {
            if (aplicar(prox, 0, false)) return;
          }
          nodo = prox;
          continue;
        }
        if (tp === E_NODE) {
          if (aplicar(prox, 0, false)) return;
          break;
        }
        nodo = prox;
      }
      aplicar(el, 0, true);
    } catch (e) {}
  }

  function inserirDocs(doc) {
    if (!doc) return false;
    const ed = obterEditorValido();
    if (!ed) {
      toast('Editor não encontrado. Aguarde o carregamento.', true);
      return false;
    }
    const sx = window.scrollX;
    const sy = window.scrollY;
    let ok = false;
    try {
      let tinhaSel = false;
      try { tinhaSel = temRange(ed.getSelection()); } catch (e) {}
      ed.focus();
      garantirSelecao(ed, tinhaSel);
      ed.fire('saveSnapshot');
      const id = alvoIdDoc(doc);
      const antes = id ? contarIdDoc(ed, id) : null;
      let htmlAntes = '';
      try { htmlAntes = ed.document.getBody().getHtml(); } catch (e) {}
      let htmlInserir = doc.html + ' ';
      try { if (precisaEspacoAntes(ed)) htmlInserir = ' ' + htmlInserir; } catch (e) {}
      try { ed.insertHtml(htmlInserir); } catch (e) {}
      if (id) {
        const agora = contarIdDoc(ed, id);
        if (agora <= antes) {
          inserirComBookmarks(ed, htmlInserir);
          ok = contarIdDoc(ed, id) > antes;
        } else {
          ok = true;
        }
      } else {
        ok = true;
      }
      if (ok && id) {
        try { marcarCheckboxAposInserir(ed, id, htmlAntes, antes); } catch (e) {}
        try { posicionarCursorAposLink(ed, id, antes); } catch (e) {}
      }
      ed.fire('saveSnapshot');
    } catch (e) {
      ok = false;
    }
    try { window.scrollTo(sx, sy); } catch (e) {}
    if (!ok) toast('⚠️ Não foi possível inserir no editor.', true);
    return ok;
  }

  function formatarCNJ(v) {
    const d = somenteDigitos(v);
    if (d.length !== 20) return v || '';
    return d.slice(0, 7) + '-' + d.slice(7, 9) + '.' + d.slice(9, 13) + '.' + d.slice(13, 14) + '.' + d.slice(14, 16) + '.' + d.slice(16, 20);
  }

  const iconeFab = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>';
  const iconeSync = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
  const iconeColapso = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  const iconeTab = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
  const iconeDesfazer = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>';
  const iconeEngrenagem = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
  const iconeOlho = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const iconeLixeira = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

  const CSS = [
    '#dock { position: fixed; right: 20px; bottom: 20px; z-index: 9999998; display: flex; flex-direction: row; align-items: stretch; background: rgba(25, 25, 25, 0.85); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; box-shadow: 0 16px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1); transform-origin: bottom right; animation: td-abrir 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15); transition: opacity 0.35s ease, transform 0.35s ease; max-height: calc((100vh - var(--hdr-h, 62px) - 20px) * 0.93); }',
    '@keyframes td-abrir { from { opacity: 0; transform: scale(0.7) translateY(24px); } }',
    '#dock.sumido { opacity: 0; transform: scale(0.7) translateY(16px); pointer-events: none; }',
    '#dock .docs-col { width: 169px; padding: 9px 8px 5px 9px; border-right: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; min-width: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; transition: width 0.3s ease, padding 0.3s ease, opacity 0.2s ease; }',
    '#dock.recolhido .docs-col, #dock.sem-arvore .docs-col { width: 0; padding-left: 0; padding-right: 0; opacity: 0; overflow: hidden; border-right: none; }',
    '#dock .docs-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; user-select: none; margin-bottom: 6px; }',
    '#dock .docs-titulo { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '#dock .docs-acoes { display: flex; gap: 2px; flex-shrink: 0; }',
    '#dock .docs-acoes button { background: transparent; color: #777; border: none; cursor: pointer; border-radius: 4px; padding: 3px 5px; font-size: 11px; line-height: 1; opacity: 1; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; font-family: inherit; }',
    '#dock .docs-acoes button:hover { color: #fff; background: rgba(255,255,255,0.1); }',
    '#dock .docs-acoes button:active { transform: scale(0.92); }',
    '#dock .docs-acoes button.girando svg { animation: td-girar 0.8s linear infinite; }',
    '@keyframes td-girar { to { transform: rotate(360deg); } }',
    '#dock .docs-lista { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 1px; padding-right: 3px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.32) transparent; }',
    '#dock .docs-lista::-webkit-scrollbar { width: 6px; }',
    '#dock .docs-lista::-webkit-scrollbar-track { background: transparent; }',
    '#dock .docs-lista::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.32); border-radius: 3px; }',
    '#dock .docs-lista::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.55); }',
    '#dock .docs-item { display: flex; align-items: center; gap: 7px; min-height: 27px; padding: 3px 7px; border-radius: 4px; cursor: pointer; user-select: none; transition: background 0.15s ease; width: 100%; text-align: left; background: transparent; border: none; font-family: inherit; }',
    '#dock .docs-item:hover { background: rgba(255,255,255,0.07); }',
    '#dock .docs-item:active { background: rgba(255,255,255,0.12); }',
    '#dock .docs-item:hover .docs-nome, #dock .docs-item:focus-visible .docs-nome { color: #fff; }',
    '#dock .docs-item.piscar { background: rgba(255,255,255,0.12); }',
    '#dock .docs-mais { color: #a2a2a8; font-size: 11px; font-weight: 600; opacity: 0; transform: translateX(-3px); transition: all 0.15s ease; flex-shrink: 0; }',
    '#dock .docs-item:hover .docs-mais, #dock .docs-item:focus-visible .docs-mais { opacity: 1; transform: translateX(0); }',
    '#dock .docs-nome { font-size: 11px; color: #ccc; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; line-height: 1.35; transition: color 0.15s ease; }',
    '#dock .docs-status { display: flex; align-items: center; gap: 6px; border-top: 1px solid rgba(255,255,255,0.05); margin-top: auto; padding-top: 5px; font-size: 9px; color: #8a8a90; font-weight: 600; letter-spacing: 0.4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '#dock .docs-status.divergente { color: #ff6b6b; }',
    '#dock .docs-status.divergente .td-status-num { color: #ff6b6b; font-weight: 700; }',
    '#dock .docs-status.divergente .docs-live { background: #ff6b6b; }',
    '#dock .docs-live { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.38); flex-shrink: 0; }',
    '#dock .padrao-atalhos { width: max-content; min-width: 195px; max-width: 345px; display: flex; flex-direction: column; gap: 5px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 9px 9px 5px 9px; animation: td-abrir 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15); }',
    // [REVERSIVIDADE v2.4.0] Largura dos atalhos +20% (345 -> 414px fixos). PARA REVERTER: apagar APENAS a linha CSS marcada com [REVERSIVEL] logo abaixo.
    '#dock .padrao-atalhos { width: 399px; min-width: 0; max-width: none; } /* [REVERSIVEL] largura atalhos 399px */',
    '#dock .padrao-atalhos .tm-scroll { overflow-y: auto; min-height: 0; flex: 1; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.32) transparent; }',
    '#dock .padrao-atalhos .tm-scroll::-webkit-scrollbar { width: 6px; }',
    '#dock .padrao-atalhos .tm-scroll::-webkit-scrollbar-track { background: transparent; }',
    '#dock .padrao-atalhos .tm-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.32); border-radius: 3px; }',
    '#dock .padrao-atalhos .tm-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.55); }',
    '#dock .padrao-atalhos .tm-cat-header { font-size: 11px; font-weight: bold; color: #ccc; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; margin: 7px 0 3px 0; }',
    '#dock .padrao-atalhos .tm-cat-container { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-bottom: 3px; }',
    '#dock .padrao-atalhos .tm-botao { background: linear-gradient(180deg, #3d3d3d 0%, #262626 100%); color: #eaeaea; border: 1px solid #111; border-top: 1px solid #555; padding: 5px 6px; border-radius: 6px; cursor: pointer; font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease; font-family: inherit; }',
    '#dock .padrao-atalhos .tm-botao:hover { background: linear-gradient(180deg, #4d4d4d 0%, #363636 100%); color: #ffffff; border-top: 1px solid #666; transform: translateY(-1px); box-shadow: 0 3px 6px rgba(0,0,0,0.5); }',
    '#dock .padrao-atalhos .tm-botao:active { background: #1e1e1e; border-top: 1px solid #111; transform: translateY(1px); box-shadow: none; }',
    '#dock .padrao-atalhos .tm-footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 3px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 5px; }',
    '#dock .padrao-atalhos .tm-btn-min, #dock .padrao-atalhos .tm-btn-acao { background-color: transparent; color: #888888; border: none; cursor: pointer; border-radius: 4px; transition: color 0.2s ease, background 0.2s ease, transform 0.2s ease; font-family: inherit; }',
    '#dock .padrao-atalhos .tm-btn-min { padding: 3px 5px; font-size: 8.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }',
    '#dock .padrao-atalhos .tm-btn-acao { padding: 3px; display: flex; align-items: center; justify-content: center; }',
    '#dock .padrao-atalhos .tm-btn-min:hover, #dock .padrao-atalhos .tm-btn-acao:hover { color: #ffffff; background: rgba(255, 255, 255, 0.1); }',
    '#dock .padrao-atalhos .tm-btn-min:active, #dock .padrao-atalhos .tm-btn-acao:active { transform: scale(0.9); }',
    '#dock .padrao-atalhos .tm-scroll .tm-vazio { font-size: 11px; color: #666; text-align: center; padding: 14px 8px; line-height: 1.5; }',
    '#dock .tab { position: absolute; left: -1px; top: 50%; transform: translate(-100%, -50%); width: 16px; height: 46px; border-radius: 8px 0 0 8px; cursor: pointer; background: rgba(40,40,42,0.92); border: 1px solid rgba(255,255,255,0.12); border-right: none; display: flex; align-items: center; justify-content: center; color: #999; box-shadow: -8px 6px 16px rgba(0,0,0,0.5); opacity: 0; pointer-events: none; transition: opacity 0.25s ease, color 0.2s ease, background 0.2s ease; font-family: inherit; }',
    '#dock .tab:hover { color: #fff; background: rgba(60,60,64,0.95); }',
    '#dock.recolhido .tab, #dock.sem-arvore .tab { opacity: 1; pointer-events: auto; }',
    '#dock .padrao-atalhos { transition: width 0.3s ease, padding 0.3s ease, opacity 0.2s ease; }',
    '#dock.atalhos-min .padrao-atalhos { width: 0; min-width: 0; max-width: none; padding-left: 0; padding-right: 0; opacity: 0; overflow: hidden; pointer-events: none; }',
    '#dock .tab-atalhos { position: absolute; right: -1px; top: 50%; transform: translate(100%, -50%); width: 16px; height: 46px; border-radius: 0 8px 8px 0; cursor: pointer; background: rgba(40,40,42,0.92); border: 1px solid rgba(255,255,255,0.12); border-left: none; display: flex; align-items: center; justify-content: center; color: #999; box-shadow: 8px 6px 16px rgba(0,0,0,0.5); opacity: 0; pointer-events: none; transition: opacity 0.25s ease, color 0.2s ease, background 0.2s ease; font-family: inherit; }',
    '#dock .tab-atalhos:hover { color: #fff; background: rgba(60,60,64,0.95); }',
    '#dock.atalhos-min .tab-atalhos { opacity: 1; pointer-events: auto; }',
    '#dock button:focus-visible { outline: 2px solid rgba(110,231,183,0.5); outline-offset: 1px; }',
    '.td-fab { position: fixed; right: 20px; bottom: 20px; width: 40px; height: 40px; box-sizing: border-box; padding: 0; aspect-ratio: 1 / 1; -webkit-appearance: none; appearance: none; border-radius: 50%; background: linear-gradient(145deg, #383838, #000000); box-shadow: 0 8px 16px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.25), inset 0 -2px 4px rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999999; color: #ccc; transition: transform 0.3s ease, opacity 0.3s ease; border: none; font-family: inherit; }',
    '.td-fab svg { color: #ccc; }',
    '.td-fab:hover { transform: scale(1.08); }',
    '.td-fab:hover svg { color: #fff; }',
    '.td-fab.esconder { opacity: 0; transform: scale(0.2) rotate(-90deg); pointer-events: none; }',
    '.td-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10000000; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }',
    '.td-modal-overlay.td-modal-active { opacity: 1; pointer-events: auto; }',
    '.td-modal-content { background: rgba(30, 30, 32, 0.90); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 24px 32px; box-shadow: 0 24px 48px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05); transform: scale(0.90) translateY(15px); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15); color: #eaeaea; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; cursor: default; max-height: 90vh; overflow-y: auto; }',
    '.td-modal-overlay.td-modal-active .td-modal-content { transform: scale(1) translateY(0); }',
    '.td-modal-header { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #777; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; margin-bottom: 16px; text-align: center; font-weight: 700; }',
    '.td-input { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px; width: 100%; outline: none; transition: border 0.2s ease; font-family: inherit; box-sizing: border-box; }',
    '.td-input:focus { border: 1px solid rgba(255,255,255,0.4); }',
    '.td-modal-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 4px; border-radius: 6px; transition: background 0.2s ease, transform 0.2s ease; }',
    '.td-modal-row:nth-child(odd) { background: rgba(0, 0, 0, 0.25); }',
    '.td-modal-row:nth-child(even) { background: rgba(255, 255, 255, 0.04); }',
    '.td-modal-row:hover { background: rgba(255, 255, 255, 0.1); transform: scale(1.02); }',
    '.td-label-dig { font-size: 11px; color: #a0a0a0; }',
    '.td-modal-row .td-label-dig { font-size: 13px; }',
    '.td-nome { font-size: 14px; color: #f0f0f0; text-align: right; font-weight: 500; }',
    '.td-badge { background: rgba(255, 255, 255, 0.15); color: #ffffff; padding: 2px 7px; border-radius: 4px; font-weight: 700; letter-spacing: 0.5px; margin-left: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); }',
    '.td-modal-divider { margin: 20px 0 10px 0; padding: 6px 0; text-align: center; background: rgba(255,255,255,0.04); border-radius: 6px; border: 1px solid rgba(255,255,255,0.02); }',
    '.td-title-bambui { font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #ffffff; font-weight: 700; }',
    '.td-config-list-item { display: flex; justify-content: space-between; align-items: stretch; background: linear-gradient(180deg, #3d3d3d 0%, #262626 100%); border: 1px solid #111; border-top: 1px solid #555; border-radius: 5px; margin-bottom: 4px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.4); flex-shrink: 0; }',
    '.td-config-list-text { padding: 8px 10px; cursor: pointer; font-size: 12px; color: #eaeaea; font-weight: 500; flex: 1; display: flex; align-items: center; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.td-config-list-text:hover { background: rgba(255,255,255,0.05); }',
    '.td-config-list-del { background: rgba(220, 53, 69, 0.15); border: none; border-left: 1px solid #111; color: #ff6b6b; cursor: pointer; padding: 0 12px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }',
    '.td-config-list-del:hover { background: rgba(220, 53, 69, 0.8); color: #fff; }',
    '.td-modal-overlay .tm-botao { background: linear-gradient(180deg, #3d3d3d 0%, #262626 100%); color: #eaeaea; border: 1px solid #111; border-top: 1px solid #555; padding: 5px 6px; border-radius: 6px; cursor: pointer; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease; font-family: inherit; }',
    '.td-modal-overlay .tm-botao:hover { background: linear-gradient(180deg, #4d4d4d 0%, #363636 100%); color: #ffffff; border-top: 1px solid #666; transform: translateY(-1px); box-shadow: 0 3px 6px rgba(0,0,0,0.5); }',
    '.td-modal-overlay .tm-botao:active { background: #1e1e1e; border-top: 1px solid #111; transform: translateY(1px); box-shadow: none; }',
    '#td-lista-config { max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 5px; }',
    '#td-lista-config::-webkit-scrollbar { width: 6px; }',
    '#td-lista-config::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }',
    '#tm-container-geral { display: none !important; }',
    '#tm-painel-textos { display: none !important; }',
    '#tm-fab { display: none !important; }',
    '@media (prefers-reduced-motion: reduce) { #dock, #dock .padrao-atalhos, .td-modal-content { animation: none; transition: none; } }'
  ].join('\n');

  function criarEstilos() {
    if (document.getElementById('td-estilos')) return;
    const s = document.createElement('style');
    s.id = 'td-estilos';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  let dock = null;
  let fab = null;
  let dockAtivo = false;
  let conectado = false;
  let atalhosManual = false;
  let arvoreVivaEstado = null;
  let colapsoPendente = null;
  let ultimoPingAusente = 0;
  let modalConfig = null;
  let modalDigitos = null;
  let listaEl = null;

  function medirCabecalho() {
    if (CFG.hdrAltura != null) {
      const h = parseInt(CFG.hdrAltura, 10);
      if (!isNaN(h)) return Math.max(0, h);
    }
    const seletores = ['#divInfraAreaTela', '.infraAreaTela', '#page-content-wrapper', '#wrapper', '#fake-header'];
    for (let i = 0; i < seletores.length; i++) {
      let alvo = null;
      try { alvo = document.querySelector(seletores[i]); } catch (e) {}
      if (!alvo) continue;
      let top = 0;
      try { top = alvo.getBoundingClientRect().top; } catch (e) {}
      if (isFinite(top) && top > 0) return Math.max(0, Math.min(320, Math.round(top)));
    }
    return 62;
  }

  function aplicarTeto() {
    try {
      document.documentElement.style.setProperty('--hdr-h', String(medirCabecalho()) + 'px');
    } catch (e) {}
  }

  function conectar() {
    if (!dock) return;
    dock.classList.remove('sem-arvore', 'recolhido');
    conectado = true;
  }

  // [REQUISITO] Situacao da aba da Arvore de documentos no navegador: 'viva' | 'duvida' | 'ausente'.
  // Nao remove chaves (diferente de listarAbas) para nao mascarar a transicao viva -> ausente.
  function situacaoArvore() {
    if (CFG.docsFixo) return 'viva';
    const agora = Date.now();
    let existe = false;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(CHAVE_TAB) !== 0 || k === CHAVE_TAB + tabId) continue;
        let v = null;
        try { v = JSON.parse(localStorage.getItem(k)); } catch (e) {}
        if (!v || v.tipo !== 'arvore') continue;
        existe = true;
        if (v.bate && agora - v.bate <= 30000) return 'viva';
      }
    } catch (e) {}
    return existe ? 'duvida' : 'ausente';
  }

  function recolherDocsSemArvore() {
    if (!dock) return;
    dock.classList.add('sem-arvore');
    dock.classList.remove('recolhido');
    conectado = false;
  }

  function cancelarColapsoPendente() {
    if (colapsoPendente) { clearTimeout(colapsoPendente); colapsoPendente = null; }
  }

  // Confere (com ping) se a Arvore realmente sumiu antes de recolher, evitando falsos colapsos.
  function agendarRecolhimento() {
    if (colapsoPendente) return;
    arvoreVivaEstado = false;
    try { enviarPedido(); } catch (e) {}
    colapsoPendente = setTimeout(function () {
      colapsoPendente = null;
      if (situacaoArvore() === 'viva') { arvoreVivaEstado = true; return; }
      recolherDocsSemArvore();
    }, 1800);
  }

  function vigiarArvore() {
    if (!dock) return;
    const s = situacaoArvore();
    if (s === 'viva') {
      cancelarColapsoPendente();
      arvoreVivaEstado = true;
      return;
    }
    if (arvoreVivaEstado === true) {
      agendarRecolhimento();
      return;
    }
    if (s === 'ausente' && dock.classList.contains('sem-arvore')) {
      const agora = Date.now();
      if (agora - ultimoPingAusente > 5000) { ultimoPingAusente = agora; try { enviarPedido(); } catch (e) {} }
    }
  }

  function escHTML(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function listaHTML() {
    const h = [];
    for (let i = 0; i < listaDocs.length; i++) {
      const d = listaDocs[i];
      h.push('<button type="button" class="docs-item" data-idx="' + i + '" title="' + escHTML(d.label) + '" aria-label="Inserir link de ' + String(d.label || '') + '"><span class="docs-nome">' + escHTML(d.label) + '</span><span class="docs-mais">+</span></button>');
    }
    return h.join('');
  }

  function render() {
    if (!listaEl) return;
    listaEl.innerHTML = listaHTML();
  }

  function atualizarHintAlvo() {
    const hint = document.getElementById('td-cfg-alvo-hint');
    if (!hint) return;
    const campo = document.getElementById('td-cfg-alvo');
    const isRegex = document.getElementById('td-cfg-isregex');
    const alvo = campo ? campo.value : '';
    if (!alvo || !alvo.trim()) {
      hint.textContent = '';
      return;
    }
    let re;
    try {
      re = new RegExp(isRegex && isRegex.checked ? alvo : construirRegexInteligente(alvo), 'gi');
    } catch (e) {
      hint.textContent = 'regex inválida';
      return;
    }
    const ed = obterEditorValido();
    if (!ed) {
      hint.textContent = 'abra a minuta para contar as ocorrências';
      return;
    }
    let h = '';
    try { h = ed.document.getBody().getHtml(); } catch (e) {}
    hint.textContent = h ? ('Alvo encontrado ' + contarOcorrencias(h, re) + '× na minuta') : '';
  }

  function calcularOcorrenciaClicada(iframeDoc, noAlvo, textoCapturado) {
    try {
      if (!iframeDoc || !noAlvo || typeof iframeDoc.createTreeWalker !== 'function') return 0;
      const busca = normalizarTexto(textoCapturado);
      if (!busca) return 0;
      let prefixo = '';
      let alcancou = false;
      const walker = iframeDoc.createTreeWalker(iframeDoc.body, 4, null, false);
      let node = walker.nextNode();
      while (node) {
        if (node === noAlvo || (noAlvo.contains && noAlvo.contains(node))) {
          alcancou = true;
          break;
        }
        prefixo += node.nodeValue || '';
        node = walker.nextNode();
      }
      if (!alcancou) return 0;
      const antes = normalizarTexto(prefixo);
      let n = 0;
      let i = 0;
      while ((i = antes.indexOf(busca, i)) !== -1) {
        n++;
        i += busca.length;
      }
      const proprio = normalizarTexto(noAlvo.textContent || '');
      if (proprio.indexOf(busca) !== -1) n += 1;
      return n;
    } catch (e) { return 0; }
  }

  function abrirConfigModal() {
    atualizarDropdownPerfis();
    limparFormulario();
    modalConfig.classList.add('td-modal-active');
  }

  function fecharConfigModal() {
    modalConfig.classList.remove('td-modal-active');
    detectarPerfilAtual();
    renderPainelPrincipal();
  }

  function atualizarTituloTabs() {
    const t = document.getElementById('td-tab');
    if (t) t.title = 'Expandir aba de documentos';
    const ta = document.getElementById('td-tab-atalhos');
    if (ta) ta.title = 'Expandir painel de atalhos';
  }

  // [REQUISITO] Sem modelo vinculado, o painel de atalhos inicia minimizado (o usuario expande no clique).
  function sincronizarAtalhosMin() {
    if (!dock) return;
    if (perfilAtivo) {
      atalhosManual = false;
      dock.classList.remove('atalhos-min');
    } else if (!atalhosManual) {
      dock.classList.add('atalhos-min');
    }
    atualizarTituloTabs();
  }

  function renderPainelPrincipal() {
    const destino = document.getElementById('td-scroll');
    if (!destino) return;
    destino.innerHTML = '';
    if (!perfilAtivo) {
      const vazio = document.createElement('div');
      vazio.className = 'tm-vazio';
      vazio.innerHTML = 'Nenhum atalho configurado para este documento.<br><br>Clique na <b>engrenagem</b> abaixo para criar ou vincular um modelo.';
      destino.appendChild(vazio);
      sincronizarAtalhosMin();
      return;
    }
    const agrupado = {};
    for (let i = 0; i < perfilAtivo.regras.length; i++) {
      const regra = perfilAtivo.regras[i];
      const cat = regra.category || 'Geral';
      if (!agrupado[cat]) agrupado[cat] = [];
      agrupado[cat].push(regra);
    }
    Object.keys(agrupado).sort().forEach(function (cat) {
      const headerCat = document.createElement('div');
      headerCat.className = 'tm-cat-header';
      headerCat.textContent = cat;
      destino.appendChild(headerCat);
      const box = document.createElement('div');
      box.className = 'tm-cat-container';
      agrupado[cat].forEach(function (regra) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tm-botao';
        btn.textContent = regra.name;
        btn.title = regra.novo + (Number(regra.ocorrencia) > 0 ? ' (ocorrência ' + regra.ocorrencia + ')': '');
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          processarAcaoNoEditor(regra.id);
        });
        box.appendChild(btn);
      });
      destino.appendChild(box);
    });
    sincronizarAtalhosMin();
  }

  function atualizarDropdownPerfis() {
    const sel = document.getElementById('td-cfg-perfil-select');
    if (!sel) return;
    sel.innerHTML = '';
    perfisSalvos.forEach(function (p) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nome;
      sel.appendChild(opt);
    });
    if (perfisSalvos.length > 0) {
      if (!perfilEditandoId || !perfisSalvos.find(function (p) { return p.id === perfilEditandoId; })) {
        perfilEditandoId = perfisSalvos[0].id;
      }
      sel.value = perfilEditandoId;
      const atual = perfisSalvos.find(function (p) { return p.id === perfilEditandoId; });
      const inp = document.getElementById('td-cfg-perfil-keywords');
      if (atual && inp) inp.value = atual.keywords || '';
    } else {
      perfilEditandoId = null;
      const inp = document.getElementById('td-cfg-perfil-keywords');
      if (inp) inp.value = '';
    }
    renderListaConfig();
  }

  function renderListaConfig() {
    const lista = document.getElementById('td-lista-config');
    if (!lista) return;
    lista.innerHTML = '';
    if (!perfilEditandoId) return;
    const perfilAtual = perfisSalvos.find(function (p) { return p.id === perfilEditandoId; });
    if (!perfilAtual || !perfilAtual.regras) return;
    const regras = perfilAtual.regras.slice().sort(function (a, b) { return (a.category || '').localeCompare(b.category || ''); });
    regras.forEach(function (regra) {
      const linha = document.createElement('div');
      linha.className = 'td-config-list-item';
      const texto = document.createElement('div');
      const suffix = Number(regra.ocorrencia) > 0 ? ' · ' + regra.ocorrencia + 'ª ocorrência' : '';
      texto.textContent = '[' + (regra.category || 'Geral') + '] ' + regra.name + suffix;
      texto.className = 'td-config-list-text';
      texto.addEventListener('click', function () { carregarFormulario(regra); });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'td-config-list-del';
      del.innerHTML = iconeLixeira;
      del.title = 'Excluir atalho';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (confirm('Excluir o atalho "' + regra.name + '" deste modelo?')) {
          perfilAtual.regras = perfilAtual.regras.filter(function (r) { return r.id !== regra.id; });
          salvarPerfis();
          renderListaConfig();
          limparFormulario();
        }
      });
      linha.appendChild(texto);
      linha.appendChild(del);
      lista.appendChild(linha);
    });
  }

  function limparFormulario() {
    document.getElementById('td-cfg-id').value = '';
    document.getElementById('td-cfg-categoria').value = '';
    document.getElementById('td-cfg-nome').value = '';
    document.getElementById('td-cfg-alvo').value = '';
    document.getElementById('td-cfg-isregex').checked = false;
    document.getElementById('td-cfg-ocorrencia').value = '0';
    document.getElementById('td-cfg-novo').value = '';
    document.getElementById('td-cfg-bold').checked = false;
    document.getElementById('td-cfg-italic').checked = false;
    document.getElementById('td-cfg-underline').checked = false;
    document.getElementById('td-btn-excluir-regra').style.display = 'none';
    atualizarHintAlvo();
  }

  function carregarFormulario(regra) {
    document.getElementById('td-cfg-id').value = regra.id;
    document.getElementById('td-cfg-categoria').value = regra.category || 'Geral';
    document.getElementById('td-cfg-nome').value = regra.name;
    document.getElementById('td-cfg-alvo').value = regra.target;
    document.getElementById('td-cfg-isregex').checked = regra.isRegex || false;
    document.getElementById('td-cfg-ocorrencia').value = String(Number(regra.ocorrencia) || 0);
    document.getElementById('td-cfg-novo').value = regra.novo;
    document.getElementById('td-cfg-bold').checked = regra.bold || false;
    document.getElementById('td-cfg-italic').checked = regra.italic || false;
    document.getElementById('td-cfg-underline').checked = regra.underline || false;
    document.getElementById('td-btn-excluir-regra').style.display = 'block';
    atualizarHintAlvo();
  }

  function injetarTagFormato(tagA, tagB) {
    const txt = document.getElementById('td-cfg-novo');
    const inicio = txt.selectionStart;
    const fim = txt.selectionEnd;
    const val = txt.value;
    const sel = val.substring(inicio, fim);
    txt.value = val.substring(0, inicio) + tagA + sel + tagB + val.substring(fim);
    txt.focus();
    txt.selectionStart = inicio + tagA.length;
    txt.selectionEnd = inicio + tagA.length + sel.length;
  }

  let isCapturing = false;

  function baixarJSON(objeto, nomeArquivo) {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(objeto, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', nomeArquivo);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function importarArquivoJSON(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.readAsText(file, 'UTF-8');
      reader.onload = function (ev) {
        try {
          callback(JSON.parse(ev.target.result));
        } catch (err) {
          toast('Arquivo selecionado é inválido ou corrompido!', true);
        }
      };
    };
    input.click();
  }

  function iniciarMonitoramentoAutoX() {
    if (!window.CKEDITOR || !window.CKEDITOR.instances) return;
    function attachAutoX(editor) {
      if (!editor || editor._autoXAttached) return;
      if (typeof editor.on !== 'function') return;
      editor._autoXAttached = true;
      editor._justPastedLink = false;
      editor.on('paste', function (evt) {
        const texto = (evt.data && evt.data.dataValue) || '';
        if (/(https?:\/\/[^\s]+|eproc1g\.tjmg\.jus\.br|tjmg\.jus\.br|<a\b[^>]*href=["'][^"']+["']|widgetlinkdocumento|data-iddocumento|evento=|processo=)/i.test(texto)) {
          editor._justPastedLink = true;
          clearTimeout(editor._pasteLinkTimeout);
          editor._pasteLinkTimeout = setTimeout(function () { editor._justPastedLink = false; }, 800);
        }
      });
      editor.on('change', function () {
        if (editor._isApplyingAutoX) return;
        if (!editor._justPastedLink) return;
        editor._justPastedLink = false;
        try {
          const selecao = editor.getSelection();
          if (!selecao) return;
          const ranges = selecao.getRanges();
          if (!ranges || ranges.length === 0) return;
          let bloco = ranges[0].startContainer;
          while (bloco && typeof bloco.getName !== 'function') bloco = bloco.getParent();
          const dtd = window.CKEDITOR.dtd;
          const blocoDtd = Object.assign({}, dtd.$block, dtd.$listItem, dtd.$tableContent);
          while (bloco && !blocoDtd[bloco.getName()] && bloco.getName() !== 'body') bloco = bloco.getParent();
          if (!bloco || bloco.getName() === 'body') return;
          const regexVazio = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|\s)*\)/;
          const regexVazioG = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|\s)*\)/g;
          const htmlPre = bloco.getHtml();
          if (!regexVazio.test(htmlPre)) return;
          editor._isApplyingAutoX = true;
          const scrollX = window.scrollX;
          const scrollY = window.scrollY;
          const iframeWin = editor.window ? editor.window.$ : null;
          const iframeSX = iframeWin ? iframeWin.scrollX : 0;
          const iframeSY = iframeWin ? iframeWin.scrollY : 0;
          const conteudo = editor.ui && editor.ui.space ? editor.ui.space('contents') : null;
          let alturaOriginal = '';
          if (conteudo) {
            alturaOriginal = conteudo.getStyle('height') || '';
            conteudo.setStyle('height', conteudo.$.offsetHeight + 'px');
          }
          const bookmarks = selecao.createBookmarks();
          const htmlComBm = bloco.getHtml();
          const regexLimite = /(<br\s*\/?>|<\/?p\b[^>]*>|<\/?div\b[^>]*>|<\/?li\b[^>]*>|<\/?td\b[^>]*>|<\/?h[1-6]\b[^>]*>)/gi;
          const bmRegex = /<span[^>]*data-cke-bookmark[^>]*>.*?<\/span>/i;
          const partes = htmlComBm.split(regexLimite);
          let mudou = false;
          for (let i = 0; i < partes.length; i++) {
            if (i % 2 !== 0) continue;
            const linha = partes[i];
            const ex1 = /(?:N(?:a|ã|&atilde;|&#227;|)o|Sim)\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|:|-|\s)*\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\s)*\)/i;
            const ex2 = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\s)*\)\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|:|-|\s)*(?:N(?:a|ã|&atilde;|&#227;|)o|Sim)/i;
            const ex3 = /\(\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|X|x|\s)*\)\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0)*desconforme\s*(?:<[^>]*>|&nbsp;|&#160;|\u00A0|–|-|—|\s)*motivo/i;
            if (ex1.test(linha) || ex2.test(linha) || ex3.test(linha)) continue;
            if (bmRegex.test(linha) && regexVazio.test(linha)) {
              const bm = linha.match(bmRegex);
              const idxBm = linha.indexOf(bm[0]);
              let antes = linha.substring(0, idxBm);
              let depois = linha.substring(idxBm);
              let ultimoIdx = -1;
              let ultimoLen = 0;
              regexVazioG.lastIndex = 0;
              let m;
              while ((m = regexVazioG.exec(antes)) !== null) {
                ultimoIdx = m.index;
                ultimoLen = m[0].length;
              }
              if (ultimoIdx !== -1) {
                antes = antes.substring(0, ultimoIdx) + '( X )' + antes.substring(ultimoIdx + ultimoLen);
                partes[i] = antes + depois;
                mudou = true;
              } else {
                regexVazioG.lastIndex = 0;
                const md = regexVazioG.exec(depois);
                if (md) {
                  depois = depois.replace(md[0], '( X )');
                  partes[i] = antes + depois;
                  mudou = true;
                }
              }
              break;
            }
          }
          if (mudou) {
            bloco.setHtml(partes.join(''));
            selecao.selectBookmarks(bookmarks);
            editor.fire('saveSnapshot');
          } else {
            selecao.selectBookmarks(bookmarks);
          }
          if (conteudo) conteudo.setStyle('height', alturaOriginal);
          if (iframeWin) iframeWin.scrollTo(iframeSX, iframeSY);
          window.scrollTo(scrollX, scrollY);
          setTimeout(function () { editor._isApplyingAutoX = false; }, 10);
        } catch (e) {
          editor._isApplyingAutoX = false;
        }
      });
    }
    for (const k in window.CKEDITOR.instances) {
      attachAutoX(window.CKEDITOR.instances[k]);
    }
    if (window.CKEDITOR.on) {
      window.CKEDITOR.on('instanceReady', function (evt) {
        attachAutoX(evt.editor);
      });
    }
  }

  function criarConsole() {
    const htmlCorpo =
      '<div id="dock" class="sem-arvore">' +
        '<div class="docs-col">' +
          '<div class="docs-header">' +
            '<span class="docs-titulo">Documentos</span>' +
            '<span class="docs-acoes">' +
              '<button type="button" class="btn-sync" id="td-refresh" title="Atualizar lista da árvore">' + iconeSync + '</button>' +
              '<button type="button" class="btn-collapse" id="td-colapso" title="Recolher aba de documentos">' + iconeColapso + '</button>' +
            '</span>' +
          '</div>' +
          '<div class="docs-lista" id="td-lista"></div>' +
          '<div class="docs-status" id="td-status" title="Processo ' + formatarCNJ(procAtual) + '"><span class="docs-live"></span><span class="td-status-num">' + formatarCNJ(procAtual) + '</span></div>' +
        '</div>' +
        '<div class="padrao-atalhos">' +
          '<div class="tm-scroll" id="td-scroll"></div>' +
          '<div class="tm-footer-bar">' +
            '<div style="display:flex; gap:4px; align-items:center;">' +
              '<button type="button" class="tm-btn-acao" id="td-desfazer" title="Desfazer (Ctrl+Z)">' + iconeDesfazer + '</button>' +
              '<button type="button" class="tm-btn-acao" id="td-config" title="Configurar Ações e Perfis">' + iconeEngrenagem + '</button>' +
              '<button type="button" class="tm-btn-acao" id="td-digitos" title="Tabela de Dígitos">' + iconeOlho + '</button>' +
            '</div>' +
            '<button type="button" class="tm-btn-min" id="td-ocultar">Ocultar</button>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="tab" id="td-tab" title="Expandir aba de documentos">' + iconeTab + '</button>' +
        '<button type="button" class="tab-atalhos" id="td-tab-atalhos" title="Expandir painel de atalhos">' + iconeColapso + '</button>' +
      '</div>' +
      '<button type="button" class="td-fab esconder" id="td-fab" title="Abrir ferramentas">' + iconeFab + '</button>';

    const htmlModais =
      '<div class="td-modal-overlay" id="td-modal-config">' +
        '<div class="td-modal-content" style="min-width: 600px; width: 680px;">' +
          '<div class="td-modal-header">Gestão de Atalhos e Modelos de Minuta</div>' +
          '<div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.05);">' +
            '<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">' +
              '<label class="td-label-dig" style="margin:0;">Modelo Selecionado:</label>' +
              '<select id="td-cfg-perfil-select" class="td-input" style="flex:1; margin:0;"></select>' +
              '<button type="button" id="td-btn-exp-perfil" class="tm-botao" style="background: rgba(255,255,255,0.1); padding: 5px 8px; box-shadow:none;" title="Exportar este Modelo">⬆️</button>' +
              '<button type="button" id="td-btn-imp-perfil" class="tm-botao" style="background: rgba(255,255,255,0.1); padding: 5px 8px; box-shadow:none;" title="Importar um Modelo">⬇️</button>' +
              '<button type="button" id="td-btn-novo-perfil" class="tm-botao" style="background: rgba(0,123,255,0.4); border: 1px solid #0056b3; box-shadow:none;">+ Novo Modelo</button>' +
              '<button type="button" id="td-btn-excluir-perfil" class="tm-botao" style="background: rgba(220,53,69,0.3); border: 1px solid #dc3545; color: #ff6b6b; box-shadow:none;">Excluir Modelo</button>' +
            '</div>' +
            '<label class="td-label-dig">Palavra-Chave do Título (Pode escrever normal com acentos, o sistema traduz para o Eproc):</label>' +
            '<input type="text" id="td-cfg-perfil-keywords" class="td-input" placeholder="Ex: Certidão de Triagem, Despacho Inicial" style="margin-top:4px;">' +
          '</div>' +
          '<div style="display: flex; gap: 20px;">' +
            '<div style="flex: 1; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 15px; display: flex; flex-direction: column;">' +
              '<h4 style="font-size: 11px; margin:0 0 8px 0; color:#aaa;">Atalhos deste modelo:</h4>' +
              '<div id="td-lista-config"></div>' +
              '<button type="button" id="td-btn-add-novo" class="tm-botao" style="margin-top: 10px; text-align: center; background: rgba(255,255,255,0.05); font-size: 12px; padding: 8px; box-shadow:none;">+ Adicionar Atalho</button>' +
            '</div>' +
            '<div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">' +
              '<input type="hidden" id="td-cfg-id">' +
              '<div style="display: flex; gap: 8px;">' +
                '<label class="td-label-dig" style="display: flex; flex-direction: column; gap: 2px; flex:1;">Tópico/Categoria: <input type="text" id="td-cfg-categoria" class="td-input" placeholder="Ex: 1 Geral"></label>' +
                '<label class="td-label-dig" style="display: flex; flex-direction: column; gap: 2px; flex:1;">Rótulo do Botão: <input type="text" id="td-cfg-nome" class="td-input"></label>' +
              '</div>' +
              '<label class="td-label-dig">Texto Alvo (a ser apagado/substituído):</label>' +
              '<div style="display: flex; gap: 8px;">' +
                '<input type="text" id="td-cfg-alvo" class="td-input" placeholder="Cole ou capture na tela" style="flex: 1;">' +
                '<button type="button" id="td-btn-capturar-alvo" class="tm-botao" style="background: rgba(0,129,194,0.4); border: 1px solid #0081c2; padding: 0 10px; box-shadow:none;" title="Capturar visualmente na minuta">🎯 Capturar</button>' +
              '</div>' +
              '<label class="td-label-dig" style="display: flex; align-items: center; gap: 5px; margin-top: 4px;"><input type="checkbox" id="td-cfg-isregex"> <strong>Avançado:</strong> O alvo é um Regex puro</label>' +
              '<div style="display: flex; gap: 8px; align-items: flex-end; margin-top: 2px;">' +
                '<label class="td-label-dig" style="display: flex; flex-direction: column; gap: 2px;">Ocorrência na minuta (0 = automático): <input type="number" id="td-cfg-ocorrencia" class="td-input" min="0" max="99" step="1" value="0" style="width: 110px;"></label>' +
                '<span id="td-cfg-alvo-hint" style="font-size: 10px; color: #888; padding-bottom: 6px;"></span>' +
              '</div>' +
              '<div style="display: flex; justify-content: space-between; align-items: flex-end;">' +
                '<label class="td-label-dig" style="margin-bottom: 0;">Novo Texto (A ser digitado):</label>' +
                '<div style="display: flex; gap: 4px;">' +
                  '<button type="button" id="td-btn-fmt-bold" class="tm-botao" style="padding: 2px 8px; font-weight: bold; font-size: 10px; box-shadow:none;" title="Negrito no texto selecionado">B</button>' +
                  '<button type="button" id="td-btn-fmt-italic" class="tm-botao" style="padding: 2px 8px; font-style: italic; font-size: 10px; box-shadow:none;" title="Itálico no texto selecionado">I</button>' +
                  '<button type="button" id="td-btn-fmt-underline" class="tm-botao" style="padding: 2px 8px; text-decoration: underline; font-size: 10px; box-shadow:none;" title="Sublinhado no texto selecionado">U</button>' +
                '</div>' +
              '</div>' +
              '<textarea id="td-cfg-novo" class="td-input" style="resize: vertical; min-height: 45px;"></textarea>' +
              '<div style="display: flex; gap: 15px; align-items: center; margin-top: 2px;">' +
                '<span class="td-label-dig" style="font-size: 10px;">Aplicar em tudo:</span>' +
                '<label class="td-label-dig" style="display: flex; align-items: center; gap: 5px;"><input type="checkbox" id="td-cfg-bold"> <strong>Negrito</strong></label>' +
                '<label class="td-label-dig" style="display: flex; align-items: center; gap: 5px;"><input type="checkbox" id="td-cfg-italic"> <em>Itálico</em></label>' +
                '<label class="td-label-dig" style="display: flex; align-items: center; gap: 5px;"><input type="checkbox" id="td-cfg-underline"> <u>Sublinhado</u></label>' +
              '</div>' +
              '<div style="display: flex; gap: 10px; margin-top: auto; padding-top: 10px;">' +
                '<button type="button" id="td-btn-salvar-regra" class="tm-botao" style="flex: 1; text-align: center; background: rgba(40,167,69,0.3); border: 1px solid rgba(40,167,69,0.5); font-size: 12px; padding: 8px; box-shadow:none;">Salvar Atalho</button>' +
                '<button type="button" id="td-btn-excluir-regra" class="tm-botao" style="flex: 1; text-align: center; background: rgba(220,53,69,0.3); border: 1px solid rgba(220,53,69,0.5); font-size: 12px; padding: 8px; box-shadow:none;">Excluir Atalho</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">' +
            '<div style="display: flex; gap: 10px;">' +
              '<button type="button" id="td-btn-exportar-tudo" class="tm-botao" style="background: rgba(255,255,255,0.05); font-size: 11px; padding: 6px 12px; box-shadow:none;">⬆️ Exportar Backup</button>' +
              '<button type="button" id="td-btn-importar-tudo" class="tm-botao" style="background: rgba(255,255,255,0.05); font-size: 11px; padding: 6px 12px; box-shadow:none;">⬇️ Importar Backup</button>' +
            '</div>' +
            '<button type="button" id="td-fechar-config" class="tm-botao" style="padding: 6px 16px; font-size: 12px; box-shadow:none;">Fechar Janela</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="td-modal-overlay" id="td-modal-digitos">' +
        '<div class="td-modal-content" style="min-width: 300px;">' +
          '<div class="td-modal-header">Escala por Dígitos</div>' +
          '<div class="td-modal-row"><span class="td-label-dig">Dígitos <strong class="td-badge">0</strong></span><span class="td-nome">Daniel Leite Chaves</span></div>' +
          '<div class="td-modal-row"><span class="td-label-dig">Dígitos <strong class="td-badge">2, 4 e 6</strong></span><span class="td-nome">Sabrina da Cunha Peixoto Ladeira</span></div>' +
          '<div class="td-modal-row"><span class="td-label-dig">Dígitos <strong class="td-badge">1, 3, 5 e 8</strong></span><span class="td-nome">Gustavo Câmara Corte Real</span></div>' +
          '<div class="td-modal-row"><span class="td-label-dig">Dígito <strong class="td-badge">9</strong></span><span class="td-nome">Douglas Silva Dias</span></div>' +
          '<div class="td-modal-row"><span class="td-label-dig">Dígito <strong class="td-badge">7</strong></span><span class="td-nome">Artur Bernardes Lopes Filho</span></div>' +
          '<div class="td-modal-divider"><strong class="td-title-bambui">Bambuí</strong></div>' +
          '<div class="td-modal-row"><span class="td-label-dig">Dígito <strong class="td-badge">8</strong></span><span class="td-nome">Artur Bernardes Lopes Filho</span></div>' +
          '<div class="td-modal-row"><span class="td-label-dig">Dígito <strong class="td-badge">0, 2, 4, 6</strong></span><span class="td-nome">Juliana Ferreira Sicuro de Moraes</span></div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', htmlCorpo + htmlModais);

    dock = document.getElementById('dock');
    try { dock.setAttribute('data-td-papel', papel); } catch (e) {}
    fab = document.getElementById('td-fab');
    listaEl = document.getElementById('td-lista');
    modalConfig = document.getElementById('td-modal-config');
    modalDigitos = document.getElementById('td-modal-digitos');
    dockAtivo = true;

    document.getElementById('td-refresh').addEventListener('click', function (e) {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.classList.add('girando');
      setTimeout(function () { btn.classList.remove('girando'); }, 900);
      enviarPedido();
    });

    document.getElementById('td-colapso').addEventListener('click', function (e) {
      e.stopPropagation();
      dock.classList.add('recolhido');
    });

    document.getElementById('td-tab').addEventListener('click', function (e) {
      e.stopPropagation();
      dock.classList.remove('recolhido', 'sem-arvore');
      conectado = true;
      if (procExibido && procExibido !== procAtual) expandManual = true;
      atualizarStatusDocs();
      atualizarTituloTabs();
    });

    document.getElementById('td-tab-atalhos').addEventListener('click', function (e) {
      e.stopPropagation();
      dock.classList.remove('atalhos-min');
      atalhosManual = true;
      atualizarTituloTabs();
    });

    document.getElementById('td-ocultar').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dock.classList.add('sumido');
      fab.classList.remove('esconder');
    });

    fab.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dock.classList.remove('sumido');
      fab.classList.add('esconder');
    });

    document.getElementById('td-desfazer').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      desfazerUltimaAcao();
    });

    document.getElementById('td-config').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      abrirConfigModal();
    });

    document.getElementById('td-digitos').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      modalDigitos.classList.add('td-modal-active');
    });

    modalDigitos.addEventListener('click', function (e) {
      if (e.target === modalDigitos) modalDigitos.classList.remove('td-modal-active');
    });

    listaEl.addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('.docs-item') : null;
      if (!b) return;
      const idx = parseInt(b.getAttribute('data-idx'), 10);
      const d = listaDocs[idx];
      if (!d) return;
      if (inserirDocs(d)) enviarMarcarDoc(d.idDocumento);
      b.classList.add('piscar');
      setTimeout(function () { b.classList.remove('piscar'); }, 600);
    });

    document.getElementById('td-btn-fmt-bold').addEventListener('click', function () { injetarTagFormato('<b>', '</b>'); });
    document.getElementById('td-btn-fmt-italic').addEventListener('click', function () { injetarTagFormato('<i>', '</i>'); });
    document.getElementById('td-btn-fmt-underline').addEventListener('click', function () { injetarTagFormato('<u>', '</u>'); });

    document.getElementById('td-btn-capturar-alvo').addEventListener('click', function () {
      const editor = obterEditorValido();
      if (!editor || !editor.document || !editor.document.$) {
        toast('Editor carregando... Tente novamente em 2 segundos.', true);
        return;
      }
      modalConfig.classList.remove('td-modal-active');
      isCapturing = true;
      toast('🎯 MODO DE CAPTURA: Clique exatamente no texto/linha que deseja substituir. (ESC para cancelar)', false, 6000);
      const iframeDoc = editor.document.$;
      const styleEl = iframeDoc.createElement('style');
      styleEl.id = 'td-capture-style';
      styleEl.innerHTML = '.td-capturing-mode .td-capture-hover-line { cursor: crosshair !important; border-radius: 2px; transition: background-color 0.1s; } .td-capturing-mode .td-capture-hover-line:hover { outline: 2px dashed #0081c2 !important; background-color: rgba(0,129,194,0.3) !important; box-shadow: 0 0 0 2px rgba(0,129,194,0.1) !important; } .td-capturing-mode img { pointer-events: none !important; }';
      iframeDoc.head.appendChild(styleEl);
      iframeDoc.body.classList.add('td-capturing-mode');
      const walker = iframeDoc.createTreeWalker(iframeDoc.body, NodeFilter.SHOW_TEXT, null, false);
      const paraEmbrulhar = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue.trim() !== '' && node.parentNode.nodeName !== 'SCRIPT' && node.parentNode.nodeName !== 'STYLE' && !node.parentNode.classList.contains('td-capture-hover-line')) {
          paraEmbrulhar.push(node);
        }
      }
      paraEmbrulhar.forEach(function (txtNode) {
        const span = iframeDoc.createElement('span');
        span.className = 'td-capture-hover-line';
        span.textContent = txtNode.nodeValue;
        txtNode.parentNode.replaceChild(span, txtNode);
      });
      function stopCaptura() {
        isCapturing = false;
        iframeDoc.body.classList.remove('td-capturing-mode');
        const st = iframeDoc.getElementById('td-capture-style');
        if (st) st.remove();
        const spans = iframeDoc.querySelectorAll('.td-capture-hover-line');
        spans.forEach(function (span) {
          const pai = span.parentNode;
          if (!pai) return;
          while (span.firstChild) pai.insertBefore(span.firstChild, span);
          pai.removeChild(span);
        });
        iframeDoc.body.normalize();
        iframeDoc.removeEventListener('click', aoClicar, true);
        iframeDoc.removeEventListener('keydown', aoTecla, true);
        document.removeEventListener('keydown', aoTecla, true);
        modalConfig.classList.add('td-modal-active');
      }
      function aoClicar(e) {
        if (!isCapturing) return;
        e.preventDefault();
        e.stopPropagation();
        const alvo = e.target;
        const spanAlvo = alvo.closest ? alvo.closest('.td-capture-hover-line') : null;
        let texto = '';
        if (spanAlvo) texto = spanAlvo.textContent;
        else texto = alvo.innerText || alvo.textContent || '';
        const limpo = texto.replace(/\s+/g, ' ').trim();
        if (limpo && limpo.length > 0) {
          document.getElementById('td-cfg-alvo').value = limpo;
          const occ = calcularOcorrenciaClicada(iframeDoc, spanAlvo || alvo, limpo);
          document.getElementById('td-cfg-ocorrencia').value = String(occ > 0 ? occ : 0);
          atualizarHintAlvo();
          toast('✅ Trecho capturado com sucesso!');
        } else {
          toast('⚠️ Espaço vazio capturado. Tente clicar exatamente no texto.', true);
        }
        stopCaptura();
      }
      function aoTecla(e) {
        if (e.key === 'Escape' && isCapturing) {
          toast('Captura cancelada pelo usuário.', true);
          stopCaptura();
        }
      }
      iframeDoc.addEventListener('click', aoClicar, true);
      iframeDoc.addEventListener('keydown', aoTecla, true);
      document.addEventListener('keydown', aoTecla, true);
    });

    document.getElementById('td-btn-exportar-tudo').addEventListener('click', function () {
      baixarJSON(perfisSalvos, 'eproc_atalhos_backup_geral.json');
    });

    document.getElementById('td-btn-importar-tudo').addEventListener('click', function () {
      if (!confirm('CUIDADO: Importar um backup geral apagará TODOS os seus modelos e atalhos atuais.\nDeseja continuar?')) return;
      importarArquivoJSON(function (data) {
        if (Array.isArray(data) && data.length > 0 && data[0].regras) {
          perfisSalvos = data;
          salvarPerfis();
          atualizarDropdownPerfis();
          toast('Backup Geral importado com sucesso!');
        } else {
          toast('O arquivo selecionado não parece ser um backup válido de atalhos.', true);
        }
      });
    });

    document.getElementById('td-btn-exp-perfil').addEventListener('click', function () {
      if (!perfilEditandoId) {
        toast('Selecione um modelo primeiro.', true);
        return;
      }
      const p = perfisSalvos.find(function (x) { return x.id === perfilEditandoId; });
      const nome = p.nome.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      baixarJSON(p, 'eproc_modelo_' + nome + '.json');
    });

    document.getElementById('td-btn-imp-perfil').addEventListener('click', function () {
      importarArquivoJSON(function (data) {
        let perfil = Array.isArray(data) ? data[0] : data;
        if (perfil && perfil.nome && perfil.regras) {
          perfil.id = 'perfil_' + Date.now();
          perfil.nome = perfil.nome + ' (Importado)';
          perfisSalvos.push(perfil);
          perfilEditandoId = perfil.id;
          salvarPerfis();
          atualizarDropdownPerfis();
          toast('Modelo "' + perfil.nome + '" carregado com sucesso!');
        } else {
          toast('O arquivo selecionado não é um modelo válido.', true);
        }
      });
    });

    const selPerfil = document.getElementById('td-cfg-perfil-select');
    selPerfil.addEventListener('change', function (e) {
      perfilEditandoId = e.target.value;
      const p = perfisSalvos.find(function (x) { return x.id === perfilEditandoId; });
      if (p) document.getElementById('td-cfg-perfil-keywords').value = p.keywords || '';
      limparFormulario();
      renderListaConfig();
    });

    document.getElementById('td-cfg-perfil-keywords').addEventListener('input', function (e) {
      if (!perfilEditandoId) return;
      const p = perfisSalvos.find(function (x) { return x.id === perfilEditandoId; });
      if (p) {
        p.keywords = e.target.value;
        salvarPerfis();
      }
    });

    document.getElementById('td-btn-novo-perfil').addEventListener('click', function () {
      let partes = document.title.split('-');
      let sugestao = partes[partes.length - 1].trim();
      sugestao = sugestao.replace(/[0-9]/g, '').trim();
      sugestao = sugestao.replace(/^[-. ]+|[-. ]+$/g, '').replace(/\s+/g, ' ');
      if (!sugestao || sugestao.toLowerCase() === 'eproc') sugestao = 'Modelo de Minuta';
      const nome = prompt('Confirme o nome do novo Modelo de Minuta (Palavra-chave):', sugestao);
      if (nome && nome.trim() !== '') {
        const novo = { id: 'perfil_' + Date.now(), nome: nome.trim(), keywords: nome.trim(), regras: [] };
        perfisSalvos.push(novo);
        perfilEditandoId = novo.id;
        salvarPerfis();
        atualizarDropdownPerfis();
        toast('Modelo criado com sucesso!');
      }
    });

    document.getElementById('td-btn-excluir-perfil').addEventListener('click', function () {
      if (!perfilEditandoId) return;
      const p = perfisSalvos.find(function (x) { return x.id === perfilEditandoId; });
      if (confirm('Tem certeza que deseja excluir todo o modelo "' + p.nome + '" e todos os seus atalhos?')) {
        perfisSalvos = perfisSalvos.filter(function (x) { return x.id !== perfilEditandoId; });
        salvarPerfis();
        atualizarDropdownPerfis();
      }
    });

    document.getElementById('td-btn-add-novo').addEventListener('click', limparFormulario);

    document.getElementById('td-cfg-alvo').addEventListener('input', atualizarHintAlvo);
    document.getElementById('td-cfg-isregex').addEventListener('change', atualizarHintAlvo);

    document.getElementById('td-fechar-config').addEventListener('click', fecharConfigModal);

    document.getElementById('td-btn-salvar-regra').addEventListener('click', function () {
      if (!perfilEditandoId) {
        toast('Crie ou selecione um Modelo de Minuta primeiro!', true);
        return;
      }
      const p = perfisSalvos.find(function (x) { return x.id === perfilEditandoId; });
      const alvo = document.getElementById('td-cfg-alvo').value;
      if (!alvo || alvo.trim() === '') {
        toast('O campo \'Texto Alvo\' é obrigatório.', true);
        return;
      }
      const id = document.getElementById('td-cfg-id').value || 'regra_' + Date.now();
      const nova = {
        id: id,
        category: document.getElementById('td-cfg-categoria').value || 'Geral',
        name: document.getElementById('td-cfg-nome').value || 'Novo Botão',
        target: alvo,
        isRegex: document.getElementById('td-cfg-isregex').checked,
        ocorrencia: Math.max(0, parseInt(document.getElementById('td-cfg-ocorrencia').value, 10) || 0),
        novo: document.getElementById('td-cfg-novo').value || '',
        bold: document.getElementById('td-cfg-bold').checked,
        italic: document.getElementById('td-cfg-italic').checked,
        underline: document.getElementById('td-cfg-underline').checked,
        font: ''
      };
      const index = p.regras.findIndex(function (r) { return r.id === id; });
      if (index !== -1) p.regras[index] = nova;
      else p.regras.push(nova);
      salvarPerfis();
      renderListaConfig();
      limparFormulario();
      toast('✅ Atalho Salvo!');
    });

    document.getElementById('td-btn-excluir-regra').addEventListener('click', function () {
      const id = document.getElementById('td-cfg-id').value;
      if (id && perfilEditandoId) {
        const p = perfisSalvos.find(function (x) { return x.id === perfilEditandoId; });
        p.regras = p.regras.filter(function (r) { return r.id !== id; });
        salvarPerfis();
        renderListaConfig();
        limparFormulario();
      }
    });

    modalConfig.addEventListener('click', function (e) {
      if (e.target === modalConfig && !isCapturing) fecharConfigModal();
    });

    renderPainelPrincipal();
  }

  function estado() {
    return {
      papel: papel,
      tabId: tabId,
      proc: procAtual,
      docs: listaDocs.length,
      bloqueio: estadoUI.bloqueio,
      painel: dockAtivo ? 'original' : null,
      aberto: dockAtivo ? !dock.classList.contains('recolhido') && !dock.classList.contains('sem-arvore') : null,
      conectado: conectado,
      oculto: dockAtivo ? dock.classList.contains('sumido') : null,
      atalhosMin: dockAtivo ? dock.classList.contains('atalhos-min') : null,
      procDocs: procExibido,
      divergente: !!(procExibido && procAtual && procExibido !== procAtual),
      ultimoPedido: estadoUI.ultimoPedido,
      ultimoDocs: estadoUI.ultimoDocs
    };
  }

  function exporApi() {
    const api = { papel: papel, tabId: tabId, estado: estado };
    if (papel === 'arvore') {
      api.extrairDocs = extrairDocs;
      api.marcarNaArvore = marcarNaArvore;
    }
    if (papel === 'minuta') {
      api.inserir = function (idx) {
        const d = typeof idx === 'number' ? listaDocs[idx] : idx;
        return inserirDocs(d);
      };
      api.marcar = function (idx) {
        const d = typeof idx === 'number' ? listaDocs[idx] : idx;
        if (!d || !d.idDocumento) return false;
        return enviarMarcarDoc(d.idDocumento);
      };
      api.atualizar = function () { enviarPedido(); return true; };
      api.renderPainel = function () { renderPainelPrincipal(); return true; };
    }
    window.__TDOCS_API__ = window.__TDOCS_API__ || {};
    window.__TDOCS_API__[tabId] = api;
  }

  function iniciarConsumidor() {
    criarEstilos();
    aplicarTeto();
    detectarPerfilAtual();
    criarConsole();
    render();

    // [REQUISITO] Um snapshot memorizado NAO reconecta sozinho: sem arvore ativa o painel inicia minimizado.
    const snap = lerSnapshot(procAtual);
    if (snap) receberDocs(snap, false, procAtual);
    if (CFG.docsFixo) receberDocs(CFG.docsFixo, true, procAtual);
    atualizarStatusDocs();

    aoMensagem = function (msg) {
      if (!msg) return;
      if (msg.tipo === 'arvoreAberta') {
        if (msg.proc && msg.proc === procAtual) enviarPedido();
        return;
      }
      if (msg.tipo !== 'docs') return;
      if (Array.isArray(msg.docs)) receberDocs(msg.docs, true, msg.proc);
    };

    enviarPedido();
    setTimeout(enviarPedido, 1500);
    setTimeout(aplicarTeto, 400);
    setTimeout(aplicarTeto, 1500);

    let timRes = null;
    window.addEventListener('resize', function () {
      clearTimeout(timRes);
      timRes = setTimeout(aplicarTeto, 120);
    });

    let contagemPerfil = 0;
    const vigiaPerfil = setInterval(function () {
      contagemPerfil++;
      const antes = perfilAtivo ? perfilAtivo.id : null;
      detectarPerfilAtual();
      const depois = perfilAtivo ? perfilAtivo.id : null;
      if (antes !== depois) renderPainelPrincipal();
      if (perfilAtivo || contagemPerfil >= 15) clearInterval(vigiaPerfil);
    }, 1000);

    const vigiaEditor = setInterval(function () {
      if (window.CKEDITOR && window.CKEDITOR.instances && Object.keys(window.CKEDITOR.instances).length > 0) {
        clearInterval(vigiaEditor);
        iniciarMonitoramentoAutoX();
      }
    }, 800);

    setInterval(function () {
      relerProcesso();
      vigiarArvore();
    }, 2000);
  }

  if (papel === 'arvore') {
    iniciarProvedor();
    exporApi();
  } else {
    iniciarConsumidor();
    exporApi();
  }
})();
