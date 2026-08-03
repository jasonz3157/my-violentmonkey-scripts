// ==UserScript==
// @name         GitLab Runner 作业状态统计
// @namespace    my-violentmonkey-scripts
// @version      0.2.0
// @description  在 GitLab 管理员 Runner 页面增加 Running 和 Idle 状态统计及筛选。
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

  if (!/^\/admin\/runners\/?$/.test(window.location.pathname)) {
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
  const BUILT_IN_STAT_TITLES = new Set(['Online', 'Offline', 'Stale']);
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
          id
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
  let currentRunnerStatuses = new Map();
  let currentRunnerType = null;
  let activeJobStatusFilter = null;
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

      #${IDLE_STAT_ID} [data-testid="meta-icon"],
      #${IDLE_STAT_ID} .vm-runner-job-status-icon {
        color: var(--gl-text-color-disabled, #737278) !important;
      }

      #${RUNNING_STAT_ID} [data-testid="meta-icon"],
      #${RUNNING_STAT_ID} .vm-runner-job-status-icon {
        color: var(--gl-status-info-icon-color, #1f75cb) !important;
      }

      .vm-runner-job-status-filter {
        border-radius: 50%;
        cursor: pointer;
        outline-offset: 2px;
      }

      .vm-runner-job-status-filter:hover,
      .vm-runner-job-status-filter:focus-visible,
      .vm-runner-job-status-filter[aria-pressed="true"] {
        outline: 2px solid currentColor;
      }

      .vm-runner-job-status-filtered {
        display: none !important;
      }
    `;

    (document.head ?? document.documentElement).appendChild(style);
  }

  function getTitleElement(stat) {
    const titleElement = stat.querySelector('[data-testid="title-text"]');

    if (titleElement) {
      return titleElement;
    }

    return [...stat.querySelectorAll('span')].find((element) =>
      BUILT_IN_STAT_TITLES.has(element.textContent.trim()),
    );
  }

  function getStatTitle(stat) {
    return getTitleElement(stat)?.textContent.trim() ?? '';
  }

  function findBuiltInStats() {
    const candidates = new Set([
      ...BUILT_IN_STAT_SELECTORS.map((selector) => document.querySelector(selector)).filter(
        Boolean,
      ),
      ...document.querySelectorAll('.gl-single-stat'),
    ]);

    return [...candidates]
      .filter((stat) => BUILT_IN_STAT_TITLES.has(getStatTitle(stat)))
      .sort((left, right) => {
        const position = left.compareDocumentPosition(right);

        return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
  }

  function setIcon(stat, iconName) {
    const iconUse =
      stat.querySelector('[data-testid="meta-icon"] use') ??
      [...stat.querySelectorAll('svg use')].at(-1);

    if (!iconUse) {
      return;
    }

    iconUse.closest('svg')?.classList.add('vm-runner-job-status-icon');

    for (const attrName of ['href', 'xlink:href']) {
      const href = iconUse.getAttribute(attrName);

      if (href) {
        iconUse.setAttribute(attrName, `${href.split('#')[0]}#${iconName}`);
      }
    }
  }

  function normalizeJobStatus(status) {
    const normalizedStatus = status?.trim().toUpperCase();

    if (normalizedStatus === 'IDLE') {
      return 'IDLE';
    }

    if (['ACTIVE', 'RUNNING'].includes(normalizedStatus)) {
      return 'RUNNING';
    }

    return null;
  }

  function getRunnerId(graphqlId) {
    return String(graphqlId).split('/').at(-1);
  }

  function getRowJobStatus(row) {
    const rowTestId = row.dataset.testid ?? '';
    const runnerId = rowTestId.replace(/^runner-row-/, '');
    const queriedStatus = currentRunnerStatuses.get(runnerId);

    if (queriedStatus) {
      return queriedStatus;
    }

    for (const element of row.querySelectorAll('span')) {
      const status = normalizeJobStatus(element.textContent);

      if (status) {
        return status;
      }
    }

    return null;
  }

  function applyRunnerFilter() {
    const rows = document.querySelectorAll(
      '[data-testid="runner-list"] tr[data-testid^="runner-row-"]',
    );

    for (const row of rows) {
      const shouldHide =
        activeJobStatusFilter && getRowJobStatus(row) !== activeJobStatusFilter;

      row.classList.toggle('vm-runner-job-status-filtered', Boolean(shouldHide));
    }
  }

  function updateFilterControls() {
    const icons = document.querySelectorAll('[data-job-status-filter]');

    for (const icon of icons) {
      const status = icon.dataset.jobStatusFilter;
      const isActive = status === activeJobStatusFilter;
      const label = status === 'RUNNING' ? 'Running' : 'Idle';

      icon.setAttribute('aria-pressed', String(isActive));
      icon.setAttribute(
        'aria-label',
        isActive ? `取消 ${label} 筛选` : `只显示 ${label} runner`,
      );
      icon.setAttribute(
        'title',
        isActive ? `取消 ${label} 筛选` : `只显示 ${label} runner`,
      );
    }
  }

  function toggleRunnerFilter(status) {
    activeJobStatusFilter = activeJobStatusFilter === status ? null : status;
    updateFilterControls();
    applyRunnerFilter();
  }

  function makeIconFilterable(stat, status) {
    const icon = stat.querySelector('.vm-runner-job-status-icon');

    if (!icon) {
      return;
    }

    icon.classList.add('vm-runner-job-status-filter');
    icon.dataset.jobStatusFilter = status;
    icon.setAttribute('role', 'button');
    icon.setAttribute('tabindex', '0');
    icon.setAttribute('focusable', 'true');
    icon.removeAttribute('aria-hidden');
    icon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleRunnerFilter(status);
    });
    icon.addEventListener('keydown', (event) => {
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        toggleRunnerFilter(status);
      }
    });
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
    const titleElement = getTitleElement(stat);
    const valueElement = getValueElement(stat);

    stat.id = id;
    stat.dataset.testid = id;

    setTextIfChanged(titleElement, title);
    setTextIfChanged(valueElement, formatCount(count));

    setIcon(stat, iconName);
    makeIconFilterable(stat, id === RUNNING_STAT_ID ? 'RUNNING' : 'IDLE');

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
    const onlineStat = builtInStats.find((stat) => getStatTitle(stat) === 'Online');
    const offlineStat = builtInStats.find((stat) => getStatTitle(stat) === 'Offline');

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
          onlineStat ?? builtInStats[0],
          RUNNING_STAT_ID,
          'Running',
          currentCounts.running,
          'status-active',
        ),
        createStat(
          offlineStat ?? builtInStats[0],
          IDLE_STAT_ID,
          'Idle',
          currentCounts.idle,
          'status-waiting',
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
    updateFilterControls();
    applyRunnerFilter();
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
    const statuses = new Map();
    let after = null;

    do {
      const runners = await requestRunnerStatuses(type, after);

      for (const runner of runners.nodes ?? []) {
        const status = normalizeJobStatus(runner.jobExecutionStatus);

        statuses.set(getRunnerId(runner.id), status);

        if (status === 'IDLE') {
          counts.idle += 1;
        } else if (status === 'RUNNING') {
          counts.running += 1;
        }
      }

      if (!runners.pageInfo?.hasNextPage) {
        break;
      }

      after = runners.pageInfo.endCursor;
    } while (after);

    return { counts, statuses };
  }

  async function refreshCounts() {
    if (refreshPromise || document.hidden) {
      return refreshPromise;
    }

    const runnerType = getRunnerType();
    currentRunnerType = runnerType;
    refreshPromise = loadCounts(runnerType)
      .then(({ counts, statuses }) => {
        if (runnerType === getRunnerType()) {
          currentCounts = counts;
          currentRunnerStatuses = statuses;
          updateRenderedCounts();
          applyRunnerFilter();
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
      currentRunnerStatuses = new Map();
      updateRenderedCounts();
      applyRunnerFilter();
      void refreshCounts();
    }
  }

  function start() {
    ensureSummary();
    void refreshCounts();

    const observer = new MutationObserver(() => {
      ensureSummary();
      refreshIfRunnerTypeChanged();
      applyRunnerFilter();
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
