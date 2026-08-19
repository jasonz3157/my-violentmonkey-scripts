// ==UserScript==
// @name         IT之家增强
// @namespace    my-violentmonkey-scripts
// @version      0.2.0
// @description  精简 IT之家评论者属地，并隐藏反对率过高且反对数达到阈值的评论，支持楼中楼评论。
// @author       jasonz3157
// @match        https://www.ithome.com/*/*/*.htm
// @icon         https://www.ithome.com/favicon.ico
// @grant        GM_addStyle
// @run-at       document-idle
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/ithome-enhanced.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/ithome-enhanced.js
// ==/UserScript==

(function () {
  'use strict';

  const MIN_AGAINST_COUNT = 5;
  const MIN_AGAINST_RATE = 0.75;
  const COMMENT_ROOT_SELECTOR = '#post_comm';
  const COMMENT_SELECTOR = 'li.entry, li.gh';
  const LOCATION_SELECTOR = '.posandtime';
  const LOCATION_PATTERN = /^(\s*)IT之家(.+?)网友(?=\s|$)/;
  const BLOCKED_CLASS = 'ihacb-blocked';
  const OBSERVER_DEBOUNCE_MS = 120;

  let scanTimer = 0;
  let observer = null;

  GM_addStyle(`
    .${BLOCKED_CLASS} {
      display: none !important;
    }
  `);

  function parseVoteCount(text) {
    const match = String(text || '').match(/\((\d+)\)/);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  function getDirectVoteLinks(commentItem) {
    const voteBarSelector = [
      ':scope > .codiv > .cdiv > .zhiChi',
      ':scope > .codiv > .cdiv > .comm > .zhiChi',
      ':scope > .fodiv > .cdiv > .zhiChi',
      ':scope > .cdiv > .zhiChi',
      ':scope > .cdiv > .comm > .zhiChi',
      ':scope > .cdiv > .re_comm > .zhiChi',
    ].join(', ');
    const voteBar = commentItem.querySelector(voteBarSelector);
    if (!voteBar) {
      return null;
    }

    const supportLink = voteBar.querySelector('a.s');
    const againstLink = voteBar.querySelector('a.a');
    return supportLink && againstLink ? { supportLink, againstLink } : null;
  }

  function shouldBlockComment(commentItem) {
    const voteLinks = getDirectVoteLinks(commentItem);
    if (!voteLinks) {
      return false;
    }

    const supportCount = parseVoteCount(voteLinks.supportLink.textContent);
    const againstCount = parseVoteCount(voteLinks.againstLink.textContent);
    const totalCount = supportCount + againstCount;

    return totalCount > 0 && againstCount >= MIN_AGAINST_COUNT && againstCount / totalCount >= MIN_AGAINST_RATE;
  }

  function simplifyCommentLocations(commentRoot) {
    commentRoot.querySelectorAll(LOCATION_SELECTOR).forEach((locationElement) => {
      const originalText = locationElement.textContent;
      const simplifiedText = originalText.replace(LOCATION_PATTERN, '$1$2');

      if (simplifiedText !== originalText) {
        locationElement.textContent = simplifiedText;
      }
    });
  }

  function scanComments() {
    const commentRoot = document.querySelector(COMMENT_ROOT_SELECTOR);
    if (!commentRoot) {
      return;
    }

    simplifyCommentLocations(commentRoot);

    commentRoot.querySelectorAll(COMMENT_SELECTOR).forEach((commentItem) => {
      if (shouldBlockComment(commentItem)) {
        commentItem.classList.add(BLOCKED_CLASS);
      } else {
        commentItem.classList.remove(BLOCKED_CLASS);
      }
    });
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanComments, OBSERVER_DEBOUNCE_MS);
  }

  function watchCommentRoot(commentRoot) {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(scheduleScan);
    observer.observe(commentRoot, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scanComments();
  }

  function init() {
    const commentRoot = document.querySelector(COMMENT_ROOT_SELECTOR);
    if (commentRoot) {
      watchCommentRoot(commentRoot);
      return;
    }

    const rootObserver = new MutationObserver(() => {
      const nextCommentRoot = document.querySelector(COMMENT_ROOT_SELECTOR);
      if (nextCommentRoot) {
        rootObserver.disconnect();
        watchCommentRoot(nextCommentRoot);
      }
    });

    rootObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  init();
})();
