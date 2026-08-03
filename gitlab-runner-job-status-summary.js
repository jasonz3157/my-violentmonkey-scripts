// ==UserScript==
// @name         GitLab Runner 作业状态统计
// @namespace    my-violentmonkey-scripts
// @version      0.1.0
// @description  在 GitLab 管理员 Runner 页面增加 Idle 和 Running 状态统计。
// @author       jasonz3157
// @icon         https://about.gitlab.com/images/ico/favicon.ico
// @grant        none
// @run-at       document-start
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/gitlab-runner-job-status-summary.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/gitlab-runner-job-status-summary.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.location.pathname !== '/admin/runners') {
    return;
  }

  const GRAPHQL_ENDPOINT = '/api/graphql';
  const PAGE_SIZE = 100;
  const REFRESH_INTERVAL_MS = 30_000;
  const BUILT_IN_STAT_SELECTORS = [
    '[data-testid="runner-stats-online"]',
    '[data-testid="runner-stats-offline"]',
    '[data-testid="runner-stats-stale"]',
  ];
  const SUMMARY_ID = 'vm-runner-job-status-summary';
  const DIVIDER_ID = 'vm-runner-job-status-divider';
  const IDLE_STAT_ID = 'vm-runner-job-status-idle';
  const RUNNING_STAT_ID = 'vm-runner-job-status-running';
  const RUNNER_TYPES = new Set(['INSTANCE_TYPE', 'GROUP_TYPE', 'PROJECT_TYPE']);
  const RUNNER_STATUSES_QUERY = `
    query getRunnerJobExecutionStatuses(
      $first: Int!
      $after: String
      $type: CiRunnerType
    ) {
      runners(first: $first, after: $after, type: $type) {
        nodes {
          jobExecutionStatus
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `;

  let currentCounts = { idle: null, running: null };
  let currentRunnerType = null;
  let refreshTimer = 0;
  let refreshPromise = null;

  function addStyle() {
    const style = document.createElement('style');

    style.textContent = `
      #${DIVIDER_ID} {
        align-self: stretch;
        border-left: 1px solid var(--gl-border-color-default, #bfbfc3);
        margin: 0 0.75rem;
      }

      #${SUMMARY_ID} {
        display: contents;
      }

      #${IDLE_STAT_ID} [data-testid="meta-icon"] {
        color: var(--gl-text-color-disabled, #737278) !important;
      }

      #${RUNNING_STAT_ID} [data-testid="meta-icon"] {
        color: var(--gl-status-info-icon-color, #1f75cb) !important;
      }
    `;

    (document.head ?? document.documentElement).appendChild(style);
  }

  function findBuiltInStats() {
    return BUILT_IN_STAT_SELECTORS.map((selector) => document.querySelector(selector)).filter(
      Boolean,
    );
  }

  function setIcon(stat, iconName) {
    const iconUse = stat.querySelector('[data-testid="meta-icon"] use');

    if (!iconUse) {
      return;
    }

    for (const attrName of ['href', 'xlink:href']) {
      const href = iconUse.getAttribute(attrName);

      if (href) {
        iconUse.setAttribute(attrName, `${href.split('#')[0]}#${iconName}`);
      }
    }
  }

  function formatCount(count) {
    return typeof count === 'number' ? count.toLocaleString() : '-';
  }

  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
  }

  function getValueElement(stat) {
    if (!stat) {
      return null;
    }

    return (
      stat.querySelector('[data-testid="non-animated-value"]') ??
      stat.querySelector('[data-testid="displayValue"]')
    );
  }

  function createStat(source, id, title, count, iconName) {
    const stat = source.cloneNode(true);
    const titleElement = stat.querySelector('[data-testid="title-text"]');
    const valueElement = getValueElement(stat);

    stat.id = id;
    stat.dataset.testid = id;

    setTextIfChanged(titleElement, title);
    setTextIfChanged(valueElement, formatCount(count));

    setIcon(stat, iconName);

    return stat;
  }

  function updateRenderedCounts() {
    const idleStat = document.getElementById(IDLE_STAT_ID);
    const runningStat = document.getElementById(RUNNING_STAT_ID);

    setTextIfChanged(getValueElement(idleStat), formatCount(currentCounts.idle));
    setTextIfChanged(getValueElement(runningStat), formatCount(currentCounts.running));
  }

  function ensureSummary() {
    const builtInStats = findBuiltInStats();
    const lastBuiltInStat = builtInStats.at(-1);
    const container = lastBuiltInStat?.parentElement;
    const onlineStat = document.querySelector('[data-testid="runner-stats-online"]');
    const offlineStat = document.querySelector('[data-testid="runner-stats-offline"]');

    if (!container) {
      return;
    }

    let divider = document.getElementById(DIVIDER_ID);
    let summary = document.getElementById(SUMMARY_ID);

    if (!divider || !summary) {
      divider = document.createElement('div');
      summary = document.createElement('div');

      divider.id = DIVIDER_ID;
      divider.setAttribute('aria-hidden', 'true');
      summary.id = SUMMARY_ID;
      summary.append(
        createStat(
          offlineStat ?? builtInStats[0],
          IDLE_STAT_ID,
          'Idle',
          currentCounts.idle,
          'status-waiting',
        ),
        createStat(
          onlineStat ?? builtInStats[0],
          RUNNING_STAT_ID,
          'Running',
          currentCounts.running,
          'status-active',
        ),
      );
    }

    if (
      divider.parentElement !== container ||
      divider.previousElementSibling !== lastBuiltInStat ||
      summary.previousElementSibling !== divider
    ) {
      lastBuiltInStat.after(divider, summary);
    }

    updateRenderedCounts();
  }

  function getRunnerType() {
    const searchParams = new URLSearchParams(window.location.search);
    const runnerType = searchParams.get('runner_type[]') ?? searchParams.get('runner_type');

    return RUNNER_TYPES.has(runnerType) ? runnerType : null;
  }

  async function requestRunnerStatuses(type, after = null) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({
        query: RUNNER_STATUSES_QUERY,
        variables: {
          first: PAGE_SIZE,
          after,
          type,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL 请求失败：HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.errors?.length) {
      throw new Error(result.errors.map(({ message }) => message).join('; '));
    }

    if (!result.data?.runners) {
      throw new Error('GraphQL 响应中缺少 runners 数据');
    }

    return result.data.runners;
  }

  async function loadCounts(type) {
    const counts = { idle: 0, running: 0 };
    let after = null;

    do {
      const runners = await requestRunnerStatuses(type, after);

      for (const runner of runners.nodes ?? []) {
        if (runner.jobExecutionStatus === 'IDLE') {
          counts.idle += 1;
        } else if (['ACTIVE', 'RUNNING'].includes(runner.jobExecutionStatus)) {
          counts.running += 1;
        }
      }

      if (!runners.pageInfo?.hasNextPage) {
        break;
      }

      after = runners.pageInfo.endCursor;
    } while (after);

    return counts;
  }

  async function refreshCounts() {
    if (refreshPromise || document.hidden) {
      return refreshPromise;
    }

    const runnerType = getRunnerType();
    currentRunnerType = runnerType;
    refreshPromise = loadCounts(runnerType)
      .then((counts) => {
        if (runnerType === getRunnerType()) {
          currentCounts = counts;
          updateRenderedCounts();
        }
      })
      .catch((error) => {
        console.error('[GitLab Runner 作业状态统计]', error);
      })
      .finally(() => {
        refreshPromise = null;

        if (runnerType !== getRunnerType()) {
          void refreshCounts();
        }
      });

    return refreshPromise;
  }

  function refreshIfRunnerTypeChanged() {
    if (getRunnerType() !== currentRunnerType) {
      currentCounts = { idle: null, running: null };
      updateRenderedCounts();
      void refreshCounts();
    }
  }

  function start() {
    ensureSummary();
    void refreshCounts();

    const observer = new MutationObserver(() => {
      ensureSummary();
      refreshIfRunnerTypeChanged();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    refreshTimer = window.setInterval(() => {
      refreshIfRunnerTypeChanged();
      void refreshCounts();
    }, REFRESH_INTERVAL_MS);

    window.addEventListener('popstate', refreshIfRunnerTypeChanged);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshIfRunnerTypeChanged();
        void refreshCounts();
      }
    });
    window.addEventListener(
      'pagehide',
      () => {
        window.clearInterval(refreshTimer);
        observer.disconnect();
      },
      { once: true },
    );
  }

  addStyle();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
