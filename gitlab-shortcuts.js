// ==UserScript==
// @name         GitLab 快捷入口
// @namespace    my-violentmonkey-scripts
// @version      0.4.2
// @description  在 GitLab 左侧栏顶部添加常用页面快捷入口，并隐藏 Create new 按钮。
// @author       jasonz3157
// @icon         https://about.gitlab.com/images/ico/favicon.ico
// @grant        none
// @run-at       document-start
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/gitlab-shortcuts.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/gitlab-shortcuts.js
// ==/UserScript==

(function () {
  'use strict';

  const SIDEBAR_TOGGLE_SELECTOR = '[data-testid="super-sidebar-collapse-button"]';
  const CREATE_NEW_MENU_SELECTOR = '[data-testid="new-menu-toggle"]';
  const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
  const SHORTCUTS = [
    {
      id: 'vm-gitlab-runners-shortcut',
      href: '/admin/runners',
      label: 'Runners',
      icon: 'rocket',
    },
    {
      id: 'vm-gitlab-dba-shortcut',
      href: '/repos/dba',
      label: 'DBA',
      icon: 'subgroup',
    },
  ];

  function hideCreateNewButton() {
    const style = document.createElement('style');

    style.textContent = `${CREATE_NEW_MENU_SELECTOR} { display: none !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
  }

  function getIconSpriteUrl(referenceElement) {
    const iconUse =
      referenceElement.querySelector('svg use') ??
      document.querySelector('svg.gl-icon use');
    const iconHref =
      iconUse?.getAttribute('href') ??
      iconUse?.getAttributeNS(XLINK_NAMESPACE, 'href');

    if (!iconHref?.includes('#')) {
      return null;
    }

    return iconHref.slice(0, iconHref.lastIndexOf('#'));
  }

  function setShortcutIcon(button, iconName, iconSpriteUrl) {
    const iconUse = button.querySelector('svg use');

    if (!iconUse) {
      return;
    }

    const iconHref = `${iconSpriteUrl}#${iconName}`;

    iconUse.setAttribute('href', iconHref);
    iconUse.setAttributeNS(XLINK_NAMESPACE, 'xlink:href', iconHref);
  }

  function createShortcutButton(shortcut, iconSpriteUrl) {
    const link = document.createElement('a');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const iconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');

    link.id = shortcut.id;
    link.href = shortcut.href;
    link.title = shortcut.label;
    link.setAttribute('aria-label', shortcut.label);
    link.className =
      'btn btn-default btn-md gl-button btn-default-tertiary btn-icon';

    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('class', 'gl-button-icon gl-icon s16');

    icon.appendChild(iconUse);
    link.appendChild(icon);
    setShortcutIcon(link, shortcut.icon, iconSpriteUrl);

    return link;
  }

  function ensureShortcutButtons() {
    const sidebarToggle = document.querySelector(SIDEBAR_TOGGLE_SELECTOR);

    if (!sidebarToggle?.parentElement) {
      return;
    }

    const iconSpriteUrl = getIconSpriteUrl(sidebarToggle);

    if (iconSpriteUrl === null) {
      return;
    }

    let nextElement = sidebarToggle;

    for (let index = SHORTCUTS.length - 1; index >= 0; index -= 1) {
      const shortcut = SHORTCUTS[index];
      const button =
        document.getElementById(shortcut.id) ??
        createShortcutButton(shortcut, iconSpriteUrl);

      setShortcutIcon(button, shortcut.icon, iconSpriteUrl);

      if (button.nextElementSibling !== nextElement) {
        nextElement.before(button);
      }

      nextElement = button;
    }
  }

  function start() {
    ensureShortcutButtons();

    const observer = new MutationObserver(ensureShortcutButtons);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  hideCreateNewButton();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
