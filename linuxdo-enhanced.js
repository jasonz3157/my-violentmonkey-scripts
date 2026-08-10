// ==UserScript==
// @name         LINUX DO Enhanced
// @namespace    my-violentmonkey-scripts
// @version      0.1.0
// @description  增强 LINUX DO 的话题浏览体验，将楼主用户名标记为红色。
// @author       jasonz3157
// @match        https://linux.do/t/*
// @icon         https://linux.do/favicon.ico
// @grant        GM_addStyle
// @run-at       document-start
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/linuxdo-enhanced.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/linuxdo-enhanced.js
// ==/UserScript==

(function () {
  'use strict';

  const TOPIC_OWNER_USERNAME_COLOR = '#e53935';

  GM_addStyle(`
    .topic-owner .topic-meta-data .names a[data-user-card] {
      color: ${TOPIC_OWNER_USERNAME_COLOR} !important;
    }
  `);
})();
