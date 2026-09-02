// ==UserScript==
// @name         V2EX 已读主题标记
// @namespace    my-violentmonkey-scripts
// @version      0.1.0
// @description  在 V2EX 列表中将打开过的主题显示为灰色，并在本地滚动保留最近 5000 条访问记录。
// @author       jasonz3157
// @match        https://www.v2ex.com/*
// @icon         https://www.v2ex.com/static/icon-192.png
// @grant        GM_addStyle
// @run-at       document-start
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/v2ex-visited-topics.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/v2ex-visited-topics.js
// ==/UserScript==

(function () {
  'use strict';

  const VISITED_TOPIC_COLOR = '#919191';
  const VISITED_TOPIC_CLASS = 'v2ex-visited-topic';
  const VISITED_TOPIC_STORAGE_KEY = 'v2ex.visited-topic-ids.v1';
  const MAX_VISITED_TOPICS = 5000;
  const TOPIC_LINK_SELECTOR = [
    'a.topic-link[href]',
    '.item_title > a[href]',
    '.item_hot_topic_title > a[href]',
  ].join(', ');
  const TOPIC_PATH_PATTERN = /^\/t\/(\d+)(?:\/|$)/;

  let visitedTopicIds = loadVisitedTopicIds();
  let scanTimer = 0;

  GM_addStyle(`
    .${VISITED_TOPIC_CLASS} {
      color: ${VISITED_TOPIC_COLOR} !important;
    }
  `);

  function loadVisitedTopicIds() {
    try {
      const storedValue = JSON.parse(localStorage.getItem(VISITED_TOPIC_STORAGE_KEY));
      if (!Array.isArray(storedValue)) {
        return new Set();
      }

      const validTopicIds = storedValue.filter(
        (topicId) => typeof topicId === 'string' && /^\d+$/.test(topicId),
      );
      return new Set(validTopicIds.slice(-MAX_VISITED_TOPICS));
    } catch {
      return new Set();
    }
  }

  function saveVisitedTopicIds() {
    try {
      localStorage.setItem(VISITED_TOPIC_STORAGE_KEY, JSON.stringify([...visitedTopicIds]));
    } catch {
      // localStorage 不可用时仍保留当前页面内的标记。
    }
  }

  function getTopicId(url) {
    try {
      const parsedUrl = new URL(url, location.origin);
      if (parsedUrl.origin !== location.origin) {
        return null;
      }

      return parsedUrl.pathname.match(TOPIC_PATH_PATTERN)?.[1] || null;
    } catch {
      return null;
    }
  }

  function rememberTopic(topicId) {
    if (!topicId) {
      return;
    }

    const mostRecentTopicId = [...visitedTopicIds].at(-1);
    if (mostRecentTopicId === topicId) {
      return;
    }

    // 重新插入已有 ID，使 Set 同时承担按最近访问顺序排列的队列。
    visitedTopicIds.delete(topicId);
    visitedTopicIds.add(topicId);

    while (visitedTopicIds.size > MAX_VISITED_TOPICS) {
      visitedTopicIds.delete(visitedTopicIds.values().next().value);
    }

    saveVisitedTopicIds();
  }

  function markTopicLink(topicLink) {
    const topicId = getTopicId(topicLink.href);
    topicLink.classList.toggle(VISITED_TOPIC_CLASS, Boolean(topicId && visitedTopicIds.has(topicId)));
  }

  function scanTopicLinks(root = document) {
    if (root instanceof Element && root.matches(TOPIC_LINK_SELECTOR)) {
      markTopicLink(root);
    }

    root.querySelectorAll(TOPIC_LINK_SELECTOR).forEach(markTopicLink);
  }

  function scan() {
    rememberTopic(getTopicId(location.href));
    scanTopicLinks();
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 50);
  }

  function handleTopicLinkClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const topicLink = event.target.closest(TOPIC_LINK_SELECTOR);
    if (!topicLink) {
      return;
    }

    rememberTopic(getTopicId(topicLink.href));
    scanTopicLinks();
  }

  function init() {
    scan();

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('click', handleTopicLinkClick, true);
    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('storage', (event) => {
      if (event.key === VISITED_TOPIC_STORAGE_KEY) {
        visitedTopicIds = loadVisitedTopicIds();
        scanTopicLinks();
      }
    });
  }

  if (document.documentElement) {
    init();
  } else {
    document.addEventListener('readystatechange', init, { once: true });
  }
})();
