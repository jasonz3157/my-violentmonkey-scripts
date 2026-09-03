// ==UserScript==
// @name         LINUX DO Enhanced
// @namespace    my-violentmonkey-scripts
// @version      0.2.2
// @description  增强 LINUX DO 的话题浏览体验，突出显示楼主，并将打开过的话题标题标记为灰色。
// @author       jasonz3157
// @match        https://linux.do/*
// @icon         data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIHZlcnNpb249IjEuMiIgYmFzZVByb2ZpbGU9InRpbnktcHMiIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTIwIDEyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+TElOVVggRE8gTG9nbzwvdGl0bGU+PGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg+PGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8+PHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4=
// @grant        GM_addStyle
// @run-at       document-start
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/linuxdo-enhanced.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/linuxdo-enhanced.js
// ==/UserScript==

(function () {
  'use strict';

  const TOPIC_OWNER_USERNAME_COLOR = '#00aeff';
  const TOPIC_OWNER_USERNAME_CLASS = 'linuxdo-enhanced-topic-owner-username';
  const TOPIC_OWNER_LINK_SELECTOR =
    '.topic-post.topic-owner > article > .row > .topic-body > .topic-meta-data .names a[data-user-card]';
  const POST_USERNAME_LINK_SELECTOR = '.topic-meta-data .names a[data-user-card]';
  const VISITED_TOPIC_TITLE_COLOR = '#919191';
  const VISITED_TOPIC_CLASS = 'linuxdo-enhanced-visited-topic';
  const VISITED_TOPIC_STORAGE_KEY = 'linuxdo-enhanced.visited-topic-ids.v1';
  const MAX_VISITED_TOPICS = 5000;
  const TOPIC_LINK_SELECTOR = 'a.raw-topic-link[href]';
  const TOPIC_PATH_PATTERN = /^\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/;

  let visitedTopicIds = loadVisitedTopicIds();
  let scanTimer = 0;

  GM_addStyle(`
    ${TOPIC_OWNER_LINK_SELECTOR},
    .${TOPIC_OWNER_USERNAME_CLASS} {
      color: ${TOPIC_OWNER_USERNAME_COLOR} !important;
    }

    .${VISITED_TOPIC_CLASS} {
      color: ${VISITED_TOPIC_TITLE_COLOR} !important;
    }
  `);

  function loadVisitedTopicIds() {
    try {
      const storedValue = JSON.parse(localStorage.getItem(VISITED_TOPIC_STORAGE_KEY));
      if (!Array.isArray(storedValue)) {
        return new Set();
      }

      return new Set(storedValue.filter((topicId) => typeof topicId === 'string').slice(-MAX_VISITED_TOPICS));
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

    const topicIds = [...visitedTopicIds];
    if (topicIds.at(-1) === topicId) {
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

  function rememberCurrentTopic() {
    rememberTopic(getTopicId(location.href));
  }

  function markTopicOwnerUsernameLinks() {
    const topicOwnerUsername = document.querySelector(TOPIC_OWNER_LINK_SELECTOR)?.dataset.userCard;

    document.querySelectorAll(POST_USERNAME_LINK_SELECTOR).forEach((usernameLink) => {
      const isTopicOwner = Boolean(
        topicOwnerUsername && usernameLink.dataset.userCard === topicOwnerUsername,
      );
      usernameLink.classList.toggle(TOPIC_OWNER_USERNAME_CLASS, isTopicOwner);
    });
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
    rememberCurrentTopic();
    markTopicOwnerUsernameLinks();
    scanTopicLinks();
  }

  function scheduleScan() {
    if (scanTimer) {
      return;
    }

    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scan();
    }, 50);
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
