// ==UserScript==
// @name         摸摸鱼关键词屏蔽
// @namespace    my-violentmonkey-scripts
// @version      0.1.1
// @description  在 momoyu.cc 热榜列表中按关键词屏蔽条目，并支持关键词导入导出。
// @author       jasonz3157
// @match        https://momoyu.cc/*
// @icon         https://momoyu.cc/favicon.ico
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/momoyu-keyword-blocker.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/momoyu-keyword-blocker.js
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'momoyu-keyword-blocker-keywords';
  const LIST_ITEM_SELECTOR = '.hot-content > li';
  const BLOCKED_CLASS = 'mmk-blocked';
  const REVEALED_ATTR = 'data-mmk-revealed';
  const KEYWORD_ATTR = 'data-mmk-keyword';
  const ORIGINAL_CLASS = 'mmk-original';
  const PLACEHOLDER_CLASS = 'mmk-placeholder';
  const FLOATING_BUTTON_ID = 'mmk-floating-button';
  const MANAGER_ID = 'mmk-manager';

  let keywords = loadKeywords();
  let scanTimer = 0;

  GM_addStyle(`
    .${ORIGINAL_CLASS} {
      display: none !important;
    }

    .${PLACEHOLDER_CLASS} {
      width: 100%;
      min-height: 17px;
      padding: 0;
      border: 0;
      color: #888;
      background: transparent;
      font: inherit;
      line-height: inherit;
      text-align: left;
      cursor: pointer;
    }

    .${PLACEHOLDER_CLASS}:hover {
      color: #d33;
      text-decoration: underline;
    }

    #${FLOATING_BUTTON_ID} {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 99999;
      min-width: 42px;
      height: 34px;
      padding: 0 10px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      color: #333;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
      font-size: 13px;
      cursor: pointer;
    }

    #${FLOATING_BUTTON_ID}:hover {
      background: #fff;
      border-color: rgba(0, 0, 0, 0.22);
    }

    #${MANAGER_ID} {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(0, 0, 0, 0.42);
      box-sizing: border-box;
    }

    .mmk-panel {
      width: min(560px, 100%);
      max-height: min(680px, 92vh);
      display: flex;
      flex-direction: column;
      border-radius: 8px;
      background: #fff;
      color: #222;
      box-shadow: 0 12px 42px rgba(0, 0, 0, 0.24);
      overflow: hidden;
      font-size: 14px;
    }

    .mmk-panel-header,
    .mmk-panel-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid #eee;
    }

    .mmk-panel-footer {
      border-top: 1px solid #eee;
      border-bottom: 0;
      justify-content: flex-end;
    }

    .mmk-panel-title {
      flex: 1;
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      line-height: 22px;
    }

    .mmk-panel-body {
      overflow: auto;
      padding: 14px 16px 16px;
    }

    .mmk-row {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    .mmk-input,
    .mmk-textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #d8d8d8;
      border-radius: 6px;
      color: #222;
      background: #fff;
      font: inherit;
      outline: none;
    }

    .mmk-input {
      height: 34px;
      padding: 0 10px;
    }

    .mmk-textarea {
      min-height: 108px;
      padding: 8px 10px;
      resize: vertical;
      line-height: 1.5;
    }

    .mmk-input:focus,
    .mmk-textarea:focus {
      border-color: #777;
    }

    .mmk-btn {
      height: 34px;
      padding: 0 12px;
      border: 1px solid #d0d0d0;
      border-radius: 6px;
      color: #222;
      background: #fff;
      font: inherit;
      white-space: nowrap;
      cursor: pointer;
    }

    .mmk-btn:hover {
      background: #f6f6f6;
    }

    .mmk-btn-primary {
      border-color: #333;
      color: #fff;
      background: #333;
    }

    .mmk-btn-primary:hover {
      background: #111;
    }

    .mmk-keyword-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 36px;
      margin: 0 0 14px;
      padding: 10px;
      border: 1px solid #eee;
      border-radius: 6px;
      background: #fafafa;
      list-style: none;
    }

    .mmk-empty {
      color: #888;
      line-height: 28px;
    }

    .mmk-keyword-item {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      height: 28px;
      padding: 0 6px 0 10px;
      border: 1px solid #ddd;
      border-radius: 999px;
      background: #fff;
      gap: 6px;
    }

    .mmk-keyword-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mmk-delete {
      width: 20px;
      height: 20px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      color: #777;
      background: transparent;
      line-height: 20px;
      cursor: pointer;
    }

    .mmk-delete:hover {
      color: #fff;
      background: #d33;
    }

    .mmk-section-title {
      margin: 14px 0 8px;
      color: #555;
      font-size: 13px;
      font-weight: 600;
    }
  `);

  GM_registerMenuCommand('管理摸摸鱼屏蔽关键词', openManager);

  function loadKeywords() {
    const saved = GM_getValue(STORAGE_KEY, []);

    if (Array.isArray(saved)) {
      return normalizeKeywords(saved);
    }

    if (typeof saved === 'string') {
      try {
        const parsed = JSON.parse(saved);
        return normalizeKeywords(Array.isArray(parsed) ? parsed : parseKeywordText(saved));
      } catch {
        return normalizeKeywords(parseKeywordText(saved));
      }
    }

    return [];
  }

  function saveKeywords(nextKeywords) {
    keywords = normalizeKeywords(nextKeywords);
    GM_setValue(STORAGE_KEY, keywords);
    refreshBlockedItems(true);
    renderManagerKeywords();
  }

  function normalizeKeywords(values) {
    const result = [];
    const seen = new Set();

    for (const value of values) {
      const keyword = String(value).trim();
      const key = keyword.toLocaleLowerCase();

      if (!keyword || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(keyword);
    }

    return result;
  }

  function parseKeywordText(text) {
    const value = String(text || '').trim();

    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // 非 JSON 时按常见分隔符导入。
    }

    return value.split(/[\n,，;；\t]+/);
  }

  function getMatchText(item) {
    const original = item.querySelector(`:scope > .${ORIGINAL_CLASS}`) || item;
    const titledLink = original.querySelector('a[title]');
    const title = titledLink?.getAttribute('title')?.trim();

    return title || original.textContent || '';
  }

  function getRankText(item) {
    const original = item.querySelector(`:scope > .${ORIGINAL_CLASS}`) || item;
    const rankElement = original.querySelector('a > span:first-child');
    const rankText = rankElement?.textContent?.trim();

    if (rankText && /^\d+\.$/.test(rankText)) {
      return `${rankText} `;
    }

    const matchedRank = (original.textContent || '').trimStart().match(/^\d+\.\s*/);
    return matchedRank?.[0] || '';
  }

  function findMatchedKeyword(item) {
    const text = getMatchText(item).toLocaleLowerCase();

    if (!text) {
      return '';
    }

    return keywords.find((keyword) => text.includes(keyword.toLocaleLowerCase())) || '';
  }

  function blockItem(item, keyword) {
    if (item.getAttribute(REVEALED_ATTR) === '1') {
      return;
    }

    let original = item.querySelector(`:scope > .${ORIGINAL_CLASS}`);
    let placeholder = item.querySelector(`:scope > .${PLACEHOLDER_CLASS}`);

    if (!original) {
      original = document.createElement('span');
      original.className = ORIGINAL_CLASS;

      while (item.firstChild) {
        original.appendChild(item.firstChild);
      }

      item.appendChild(original);
    }

    if (!placeholder) {
      placeholder = document.createElement('button');
      placeholder.type = 'button';
      placeholder.className = PLACEHOLDER_CLASS;
      placeholder.title = '点击显示原内容';
      placeholder.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        revealItem(item);
      });
      item.appendChild(placeholder);
    }

    item.classList.add(BLOCKED_CLASS);
    item.setAttribute(KEYWORD_ATTR, keyword);
    placeholder.textContent = `${getRankText(item)}已屏蔽「${keyword}」`;
  }

  function revealItem(item) {
    item.setAttribute(REVEALED_ATTR, '1');
    unblockItem(item);
  }

  function unblockItem(item) {
    const original = item.querySelector(`:scope > .${ORIGINAL_CLASS}`);
    const placeholder = item.querySelector(`:scope > .${PLACEHOLDER_CLASS}`);

    if (placeholder) {
      placeholder.remove();
    }

    if (original) {
      while (original.firstChild) {
        item.insertBefore(original.firstChild, original);
      }

      original.remove();
    }

    item.classList.remove(BLOCKED_CLASS);
    item.removeAttribute(KEYWORD_ATTR);
  }

  function processItem(item) {
    if (!(item instanceof HTMLElement)) {
      return;
    }

    const keyword = findMatchedKeyword(item);

    if (keyword) {
      blockItem(item, keyword);
    } else {
      unblockItem(item);
      item.removeAttribute(REVEALED_ATTR);
    }
  }

  function scan(root = document) {
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof Element)) {
      return;
    }

    if (root instanceof Element && root.matches(LIST_ITEM_SELECTOR)) {
      processItem(root);
    }

    for (const item of root.querySelectorAll(LIST_ITEM_SELECTOR)) {
      processItem(item);
    }
  }

  function scheduleScan() {
    if (scanTimer) {
      return;
    }

    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      keywords = loadKeywords();
      scan();
    }, 120);
  }

  function refreshBlockedItems(resetRevealed = false) {
    for (const item of document.querySelectorAll(LIST_ITEM_SELECTOR)) {
      if (resetRevealed) {
        item.removeAttribute(REVEALED_ATTR);
      }

      processItem(item);
    }
  }

  function observeListChanges() {
    const observer = new MutationObserver((mutations) => {
      let needsScan = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            needsScan = true;
            break;
          }
        }

        if (needsScan) {
          break;
        }
      }

      if (needsScan) {
        scheduleScan();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function createButton(text, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mmk-btn ${className}`.trim();
    button.textContent = text;
    return button;
  }

  function renderManagerKeywords() {
    const list = document.querySelector('#mmk-keyword-list');

    if (!list) {
      return;
    }

    list.replaceChildren();

    if (keywords.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'mmk-empty';
      empty.textContent = '暂无关键词';
      list.appendChild(empty);
      return;
    }

    for (const keyword of keywords) {
      const item = document.createElement('li');
      item.className = 'mmk-keyword-item';

      const text = document.createElement('span');
      text.className = 'mmk-keyword-text';
      text.textContent = keyword;

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'mmk-delete';
      deleteButton.title = `删除 ${keyword}`;
      deleteButton.textContent = '×';
      deleteButton.addEventListener('click', () => {
        saveKeywords(keywords.filter((itemKeyword) => itemKeyword !== keyword));
      });

      item.append(text, deleteButton);
      list.appendChild(item);
    }
  }

  function closeManager() {
    document.getElementById(MANAGER_ID)?.remove();
  }

  function openManager() {
    closeManager();

    const overlay = document.createElement('div');
    overlay.id = MANAGER_ID;

    const panel = document.createElement('div');
    panel.className = 'mmk-panel';

    const header = document.createElement('div');
    header.className = 'mmk-panel-header';

    const title = document.createElement('h2');
    title.className = 'mmk-panel-title';
    title.textContent = '关键词屏蔽';

    const closeButton = createButton('关闭');
    closeButton.addEventListener('click', closeManager);
    header.append(title, closeButton);

    const body = document.createElement('div');
    body.className = 'mmk-panel-body';

    const addRow = document.createElement('div');
    addRow.className = 'mmk-row';

    const input = document.createElement('input');
    input.className = 'mmk-input';
    input.type = 'text';
    input.placeholder = '输入关键词';

    const addButton = createButton('增加', 'mmk-btn-primary');
    const addKeyword = () => {
      const keyword = input.value.trim();

      if (!keyword) {
        return;
      }

      saveKeywords([...keywords, keyword]);
      input.value = '';
      input.focus();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        addKeyword();
      }
    });
    addButton.addEventListener('click', addKeyword);
    addRow.append(input, addButton);

    const list = document.createElement('ul');
    list.id = 'mmk-keyword-list';
    list.className = 'mmk-keyword-list';

    const importTitle = document.createElement('div');
    importTitle.className = 'mmk-section-title';
    importTitle.textContent = '导入 / 导出';

    const textarea = document.createElement('textarea');
    textarea.className = 'mmk-textarea';
    textarea.value = keywords.join('\n');
    textarea.placeholder = '每行一个关键词，也支持用逗号、分号分隔';

    const actionRow = document.createElement('div');
    actionRow.className = 'mmk-row';

    const importButton = createButton('导入覆盖', 'mmk-btn-primary');
    importButton.addEventListener('click', () => {
      saveKeywords(parseKeywordText(textarea.value));
      textarea.value = keywords.join('\n');
    });

    const copyButton = createButton('复制导出');
    copyButton.addEventListener('click', () => {
      const exportText = keywords.join('\n');
      textarea.value = exportText;

      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(exportText, 'text');
      } else {
        textarea.select();
        document.execCommand('copy');
      }
    });

    actionRow.append(importButton, copyButton);
    body.append(addRow, list, importTitle, textarea, actionRow);

    const footer = document.createElement('div');
    footer.className = 'mmk-panel-footer';

    const clearButton = createButton('清空');
    clearButton.addEventListener('click', () => {
      if (window.confirm('确定清空全部屏蔽关键词吗？')) {
        saveKeywords([]);
        textarea.value = '';
      }
    });

    const doneButton = createButton('完成', 'mmk-btn-primary');
    doneButton.addEventListener('click', closeManager);
    footer.append(clearButton, doneButton);

    panel.append(header, body, footer);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeManager();
      }
    });

    document.body.appendChild(overlay);
    renderManagerKeywords();
    input.focus();
  }

  function addFloatingButton() {
    if (document.getElementById(FLOATING_BUTTON_ID)) {
      return;
    }

    const button = document.createElement('button');
    button.id = FLOATING_BUTTON_ID;
    button.type = 'button';
    button.textContent = '屏蔽';
    button.title = '管理屏蔽关键词';
    button.addEventListener('click', openManager);
    document.body.appendChild(button);
  }

  function init() {
    addFloatingButton();
    scan();
    observeListChanges();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
