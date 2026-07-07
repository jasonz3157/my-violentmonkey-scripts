// ==UserScript==
// @name         摸摸鱼关键词屏蔽
// @namespace    my-violentmonkey-scripts
// @version      0.2.8
// @description  在摸摸鱼、多摸鱼热榜、LINUX DO 中按关键词屏蔽条目，并支持关键词导入导出。
// @author       jasonz3157
// @match        https://momoyu.cc/*
// @match        https://duomoyu.com/hot-list*
// @match        https://linux.do/*
// @icon         https://momoyu.cc/favicon32.ico
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/momoyu-keyword-blocker.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/momoyu-keyword-blocker.js
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'momoyu-keyword-blocker-keywords';
  const UPDATED_AT_KEY = 'momoyu-keyword-blocker-updated-at';
  const WEBDAV_CONFIG_KEY = 'momoyu-keyword-blocker-webdav-config';
  const SYNC_FILE_NAME = 'keywords.json';
  const DEFAULT_SITE_CONFIG = {
    itemSelector: '.hot-content > li, ul.news-list > li.news',
    titleSelector: 'a[title]',
  };
  const SITE_CONFIGS = [
    {
      hosts: ['linux.do'],
      itemSelector: 'tr.topic-list-item, .topic-list-item, .latest-topic-list-item',
      titleSelector: 'a.title.raw-link.raw-topic-link, a.raw-topic-link, a.topic-title',
    },
  ];
  const BLOCKED_CLASS = 'mmk-blocked';
  const TABLE_HIDDEN_CLASS = 'mmk-table-hidden';
  const TABLE_PLACEHOLDER_CLASS = 'mmk-table-placeholder-row';
  const REVEALED_ATTR = 'data-mmk-revealed';
  const KEYWORD_ATTR = 'data-mmk-keyword';
  const ORIGINAL_CLASS = 'mmk-original';
  const PLACEHOLDER_CLASS = 'mmk-placeholder';
  const FLOATING_BUTTON_ID = 'mmk-floating-button';
  const MANAGER_ID = 'mmk-manager';
  const DEFAULT_WEBDAV_CONFIG = {
    url: '',
    directory: 'momoyu/',
    username: '',
    password: '',
  };

  let keywords = loadKeywords();
  const siteConfig = getSiteConfig();
  let scanTimer = 0;
  let syncTimer = 0;
  let isSyncing = false;
  let hasPendingSync = false;

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

    .${TABLE_HIDDEN_CLASS} {
      display: none !important;
    }

    .${TABLE_PLACEHOLDER_CLASS} > td {
      padding: 0 !important;
    }

    .${TABLE_PLACEHOLDER_CLASS} .${PLACEHOLDER_CLASS} {
      padding: 11px 10px;
      box-sizing: border-box;
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

    .mmk-input {
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

    .mmk-input:focus {
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

    .mmk-list-action {
      margin-left: auto;
    }

    .mmk-list-action .mmk-btn {
      height: 28px;
      padding: 0 10px;
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

    .mmk-settings {
      display: grid;
      gap: 8px;
      margin-bottom: 14px;
    }

    .mmk-field {
      display: grid;
      gap: 4px;
    }

    .mmk-field-label {
      color: #555;
      font-size: 12px;
      line-height: 18px;
    }

    .mmk-sync-status {
      min-height: 18px;
      color: #666;
      font-size: 12px;
      line-height: 18px;
    }

    .mmk-sync-status-error {
      color: #c33;
    }
  `);

  GM_registerMenuCommand('管理摸摸鱼屏蔽关键词', openManager);

  function getSiteConfig() {
    const host = window.location.hostname;

    return SITE_CONFIGS.find((config) => config.hosts.includes(host)) || DEFAULT_SITE_CONFIG;
  }

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

  function saveKeywords(nextKeywords, options = {}) {
    const { sync = true, touch = true } = options;

    keywords = normalizeKeywords(nextKeywords);
    GM_setValue(STORAGE_KEY, keywords);

    if (touch) {
      setLocalUpdatedAt(Date.now());
    }

    refreshBlockedItems(true);
    renderManagerKeywords();

    if (sync) {
      scheduleWebdavSync();
    }
  }

  function getLocalUpdatedAt() {
    const value = Number(GM_getValue(UPDATED_AT_KEY, 0));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function setLocalUpdatedAt(updatedAt) {
    GM_setValue(UPDATED_AT_KEY, updatedAt);
  }

  function loadWebdavConfig() {
    const saved = GM_getValue(WEBDAV_CONFIG_KEY, {});
    const config = saved && typeof saved === 'object' ? saved : {};

    return {
      ...DEFAULT_WEBDAV_CONFIG,
      url: String(config.url || DEFAULT_WEBDAV_CONFIG.url).trim(),
      directory: String(config.directory || DEFAULT_WEBDAV_CONFIG.directory).trim(),
      username: String(config.username || DEFAULT_WEBDAV_CONFIG.username),
      password: String(config.password || DEFAULT_WEBDAV_CONFIG.password),
    };
  }

  function saveWebdavConfig(config) {
    GM_setValue(WEBDAV_CONFIG_KEY, {
      url: String(config.url || '').trim(),
      directory: String(config.directory || DEFAULT_WEBDAV_CONFIG.directory).trim(),
      username: String(config.username || ''),
      password: String(config.password || ''),
    });
  }

  function isWebdavConfigured(config) {
    return Boolean(config.url);
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

  function parseWebdavPayload(text) {
    const value = String(text || '').trim();

    if (!value) {
      return {
        keywords: [],
        updatedAt: 0,
      };
    }

    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return {
          keywords: normalizeKeywords(parsed),
          updatedAt: 0,
        };
      }

      if (parsed && typeof parsed === 'object') {
        const parsedKeywords = Array.isArray(parsed.keywords) ? parsed.keywords : parseKeywordText(parsed.keywords);

        return {
          keywords: normalizeKeywords(parsedKeywords),
          updatedAt: Number(parsed.updatedAt) || 0,
        };
      }
    } catch {
      return {
        keywords: normalizeKeywords(parseKeywordText(value)),
        updatedAt: 0,
      };
    }

    return {
      keywords: [],
      updatedAt: 0,
    };
  }

  function areKeywordsEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((keyword, index) => keyword === right[index]);
  }

  function createBasicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return `Basic ${window.btoa(binary)}`;
  }

  function getWebdavFileUrl(config) {
    const baseUrl = config.url.replace(/\/+$/, '');
    const directory = config.directory.replace(/^\/+|\/+$/g, '');

    return `${baseUrl}/${directory ? `${directory}/` : ''}${SYNC_FILE_NAME}`;
  }

  function getWebdavDirectoryUrls(config) {
    const directory = config.directory.replace(/^\/+|\/+$/g, '');

    if (!directory) {
      return [];
    }

    const urls = [];
    let currentUrl = config.url.replace(/\/+$/, '');

    for (const segment of directory.split('/').filter(Boolean)) {
      currentUrl = `${currentUrl}/${segment}`;
      urls.push(currentUrl);
    }

    return urls;
  }

  function requestWebdav(method, url, config, data = null) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('当前脚本环境不支持 GM_xmlhttpRequest'));
        return;
      }

      const headers = {};

      if (config.username || config.password) {
        headers.Authorization = createBasicAuth(config.username, config.password);
      }

      if (data !== null) {
        headers['Content-Type'] = 'application/json; charset=UTF-8';
      }

      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        timeout: 15000,
        onload: resolve,
        onerror: () => reject(new Error('WebDAV 请求失败')),
        ontimeout: () => reject(new Error('WebDAV 请求超时')),
      });
    });
  }

  async function ensureWebdavDirectory(config) {
    for (const url of getWebdavDirectoryUrls(config)) {
      const response = await requestWebdav('MKCOL', url, config);

      if (![200, 201, 405].includes(response.status)) {
        throw new Error(`创建 WebDAV 目录失败：HTTP ${response.status}`);
      }
    }
  }

  async function writeWebdavKeywords(config, nextKeywords, updatedAt = Date.now(), updateLocalTimestamp = true) {
    const nextUpdatedAt = updatedAt || Date.now();
    const payload = JSON.stringify(
      {
        version: 1,
        updatedAt: nextUpdatedAt,
        keywords: normalizeKeywords(nextKeywords),
      },
      null,
      2,
    );

    await ensureWebdavDirectory(config);

    const response = await requestWebdav('PUT', getWebdavFileUrl(config), config, payload);

    if (![200, 201, 204].includes(response.status)) {
      throw new Error(`上传 WebDAV 关键词失败：HTTP ${response.status}`);
    }

    if (updateLocalTimestamp) {
      setLocalUpdatedAt(nextUpdatedAt);
    }
  }

  async function uploadWebdavKeywords(config, updatedAt = getLocalUpdatedAt()) {
    await writeWebdavKeywords(config, keywords, updatedAt);
  }

  function setSyncStatus(text, isError = false) {
    const status = document.querySelector('#mmk-sync-status');

    if (!status) {
      return;
    }

    status.textContent = text;
    status.classList.toggle('mmk-sync-status-error', isError);
  }

  function scheduleWebdavSync() {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      syncWebdavKeywords('change');
    }, 400);
  }

  async function syncWebdavKeywords(source = 'auto') {
    const config = loadWebdavConfig();

    if (!isWebdavConfigured(config)) {
      setSyncStatus('未启用同步');
      return;
    }

    if (isSyncing) {
      hasPendingSync = true;
      return;
    }

    isSyncing = true;
    setSyncStatus(source === 'manual' ? '正在同步...' : '正在自动同步...');

    try {
      const fileUrl = getWebdavFileUrl(config);
      const response = await requestWebdav('GET', fileUrl, config);
      const localUpdatedAt = getLocalUpdatedAt();

      if (response.status === 404) {
        const nextUpdatedAt = localUpdatedAt || Date.now();
        setLocalUpdatedAt(nextUpdatedAt);
        await uploadWebdavKeywords(config, nextUpdatedAt);
        setSyncStatus('已创建远端同步文件');
        return;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`读取 WebDAV 关键词失败：HTTP ${response.status}`);
      }

      const remote = parseWebdavPayload(response.responseText);
      const remoteKeywords = remote.keywords;
      const mergedKeywords = normalizeKeywords([...remoteKeywords, ...keywords]);

      if (!areKeywordsEqual(mergedKeywords, keywords) || !areKeywordsEqual(mergedKeywords, remoteKeywords)) {
        const nextUpdatedAt = Date.now();
        saveKeywords(mergedKeywords, { sync: false, touch: false });
        setLocalUpdatedAt(nextUpdatedAt);
        await uploadWebdavKeywords(config, nextUpdatedAt);
        setSyncStatus('已合并本地和远端关键词');
        return;
      }

      setSyncStatus('关键词已同步');
    } catch (error) {
      console.warn('[momoyu-keyword-blocker] WebDAV 同步失败', error);
      setSyncStatus(error.message || 'WebDAV 同步失败', true);
    } finally {
      isSyncing = false;

      if (hasPendingSync) {
        hasPendingSync = false;
        scheduleWebdavSync();
      }
    }
  }

  function getMatchText(item) {
    const original = item.querySelector(`:scope > .${ORIGINAL_CLASS}`) || item;
    const titledLink = original.querySelector(siteConfig.titleSelector);
    const title = titledLink?.getAttribute('title')?.trim();

    return title || titledLink?.textContent?.trim() || original.textContent || '';
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

  function isTableItem(item) {
    return item.tagName === 'TR';
  }

  function getTablePlaceholder(item) {
    const next = item.nextElementSibling;

    if (next instanceof HTMLTableRowElement && next.classList.contains(TABLE_PLACEHOLDER_CLASS)) {
      return next;
    }

    return null;
  }

  function blockTableItem(item, keyword) {
    const columnCount = Math.max(item.children.length, 1);
    let placeholderRow = getTablePlaceholder(item);
    let placeholderButton = placeholderRow?.querySelector(`.${PLACEHOLDER_CLASS}`);

    if (!placeholderRow) {
      placeholderRow = document.createElement('tr');
      placeholderRow.className = TABLE_PLACEHOLDER_CLASS;

      const cell = document.createElement('td');
      cell.colSpan = columnCount;

      placeholderButton = document.createElement('button');
      placeholderButton.type = 'button';
      placeholderButton.className = PLACEHOLDER_CLASS;
      placeholderButton.title = '点击显示原内容';
      placeholderButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        revealItem(item);
      });

      cell.appendChild(placeholderButton);
      placeholderRow.appendChild(cell);
      item.after(placeholderRow);
    } else {
      const cell = placeholderRow.firstElementChild;

      if (cell instanceof HTMLTableCellElement) {
        cell.colSpan = columnCount;
      }
    }

    item.classList.add(BLOCKED_CLASS, TABLE_HIDDEN_CLASS);
    item.setAttribute(KEYWORD_ATTR, keyword);
    placeholderRow.setAttribute(KEYWORD_ATTR, keyword);
    placeholderButton.textContent = `${getRankText(item)}已屏蔽「${keyword}」`;
  }

  function blockItem(item, keyword) {
    if (item.getAttribute(REVEALED_ATTR) === '1') {
      return;
    }

    if (isTableItem(item)) {
      blockTableItem(item, keyword);
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
    if (isTableItem(item)) {
      getTablePlaceholder(item)?.remove();
      item.classList.remove(BLOCKED_CLASS, TABLE_HIDDEN_CLASS);
      item.removeAttribute(KEYWORD_ATTR);
      return;
    }

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

    if (root instanceof Element && root.matches(siteConfig.itemSelector)) {
      processItem(root);
    }

    for (const item of root.querySelectorAll(siteConfig.itemSelector)) {
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

  function scanAddedNode(node) {
    if (!(node instanceof Element || node instanceof DocumentFragment)) {
      return false;
    }

    if (node instanceof Element) {
      const item = node.closest(siteConfig.itemSelector);

      if (item) {
        processItem(item);
      }
    }

    scan(node);
    return true;
  }

  function refreshBlockedItems(resetRevealed = false) {
    for (const item of document.querySelectorAll(siteConfig.itemSelector)) {
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
          if (scanAddedNode(node)) {
            needsScan = true;
          }
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

  function createInputField(labelText, input) {
    const field = document.createElement('label');
    field.className = 'mmk-field';

    const label = document.createElement('span');
    label.className = 'mmk-field-label';
    label.textContent = labelText;

    field.append(label, input);
    return field;
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

    const actionItem = document.createElement('li');
    actionItem.className = 'mmk-list-action';

    const clearButton = createButton('清空');
    clearButton.addEventListener('click', () => {
      if (window.confirm('确定清空全部屏蔽关键词吗？')) {
        saveKeywords([]);
      }
    });

    actionItem.appendChild(clearButton);
    list.appendChild(actionItem);
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

    const actionRow = document.createElement('div');
    actionRow.className = 'mmk-row';

    const importButton = createButton('导入覆盖', 'mmk-btn-primary');
    importButton.addEventListener('click', () => {
      const importText = window.prompt('粘贴关键词内容，每行一个，也支持用逗号、分号分隔。', keywords.join('\n'));

      if (importText === null) {
        return;
      }

      saveKeywords(parseKeywordText(importText));
    });

    const copyButton = createButton('复制导出');
    copyButton.addEventListener('click', () => {
      const exportText = keywords.join('\n');

      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(exportText, 'text');
      } else {
        const copyArea = document.createElement('textarea');
        copyArea.value = exportText;
        copyArea.style.position = 'fixed';
        copyArea.style.left = '-9999px';
        document.body.appendChild(copyArea);
        copyArea.select();
        document.execCommand('copy');
        copyArea.remove();
      }
    });

    actionRow.append(importButton, copyButton);

    const webdavConfig = loadWebdavConfig();

    const syncTitle = document.createElement('div');
    syncTitle.className = 'mmk-section-title';
    syncTitle.textContent = 'WebDAV 同步';

    const settings = document.createElement('div');
    settings.className = 'mmk-settings';

    const urlInput = document.createElement('input');
    urlInput.className = 'mmk-input';
    urlInput.type = 'url';
    urlInput.placeholder = 'https://example.com/webdav';
    urlInput.value = webdavConfig.url;

    const directoryInput = document.createElement('input');
    directoryInput.className = 'mmk-input';
    directoryInput.type = 'text';
    directoryInput.placeholder = DEFAULT_WEBDAV_CONFIG.directory;
    directoryInput.value = webdavConfig.directory;

    const usernameInput = document.createElement('input');
    usernameInput.className = 'mmk-input';
    usernameInput.type = 'text';
    usernameInput.autocomplete = 'username';
    usernameInput.value = webdavConfig.username;

    const passwordInput = document.createElement('input');
    passwordInput.className = 'mmk-input';
    passwordInput.type = 'password';
    passwordInput.autocomplete = 'current-password';
    passwordInput.value = webdavConfig.password;

    settings.append(
      createInputField('WebDAV 地址', urlInput),
      createInputField('目录', directoryInput),
      createInputField('用户名', usernameInput),
      createInputField('密码', passwordInput),
    );

    const syncActionRow = document.createElement('div');
    syncActionRow.className = 'mmk-row';

    const getCurrentWebdavConfig = () => ({
      url: urlInput.value,
      directory: directoryInput.value,
      username: usernameInput.value,
      password: passwordInput.value,
    });

    const syncNowButton = createButton('立即同步', 'mmk-btn-primary');
    syncNowButton.addEventListener('click', () => {
      saveWebdavConfig(getCurrentWebdavConfig());
      syncWebdavKeywords('manual');
    });

    const clearWebdavButton = createButton('清空 WebDAV');
    clearWebdavButton.addEventListener('click', async () => {
      if (!window.confirm('确定清空 WebDAV 中的关键词吗？本地关键词不会被清空。')) {
        return;
      }

      const config = getCurrentWebdavConfig();
      saveWebdavConfig(config);
      const savedConfig = loadWebdavConfig();

      if (!isWebdavConfigured(savedConfig)) {
        setSyncStatus('请先填写 WebDAV 地址', true);
        return;
      }

      try {
        setSyncStatus('正在清空 WebDAV...');
        await writeWebdavKeywords(savedConfig, [], Date.now(), false);
        setSyncStatus('已清空 WebDAV 关键词');
      } catch (error) {
        console.warn('[momoyu-keyword-blocker] 清空 WebDAV 关键词失败', error);
        setSyncStatus(error.message || '清空 WebDAV 关键词失败', true);
      }
    });

    syncActionRow.append(syncNowButton, clearWebdavButton);

    const syncStatus = document.createElement('div');
    syncStatus.id = 'mmk-sync-status';
    syncStatus.className = 'mmk-sync-status';
    syncStatus.textContent = isWebdavConfigured(webdavConfig) ? '等待同步' : '未启用同步';

    body.append(addRow, list, importTitle, actionRow, syncTitle, settings, syncActionRow, syncStatus);

    const footer = document.createElement('div');
    footer.className = 'mmk-panel-footer';

    const doneButton = createButton('完成', 'mmk-btn-primary');
    doneButton.addEventListener('click', closeManager);
    footer.append(doneButton);

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
    syncWebdavKeywords('startup');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
