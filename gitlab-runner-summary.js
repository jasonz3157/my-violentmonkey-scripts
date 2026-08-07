// ==UserScript==
// @name         GitLab Runner 汇总
// @namespace    my-violentmonkey-scripts
// @version      0.3.2
// @description  在 GitLab 管理员 Runner 页面增加作业状态、版本统计及筛选。
// @author       jasonz3157
// @icon         https://about.gitlab.com/images/ico/favicon.ico
// @grant        none
// @run-at       document-start
// @license      GPL-3.0
// @downloadURL  https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/gitlab-runner-summary.js
// @updateURL    https://raw.githubusercontent.com/jasonz3157/my-violentmonkey-scripts/refs/heads/master/gitlab-runner-summary.js
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
  const VERSION_DIVIDER_ID = 'vm-runner-version-divider';
  const IDLE_STAT_ID = 'vm-runner-job-status-idle';
  const RUNNING_STAT_ID = 'vm-runner-job-status-running';
  const VERSION_STAT_CLASS = 'vm-runner-version-stat';
  const UNKNOWN_VERSION = 'Unknown';
  const RUNNER_TYPES = new Set(['INSTANCE_TYPE', 'GROUP_TYPE', 'PROJECT_TYPE']);
  const VERSION_COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  const RUNNER_SUMMARY_QUERY = `
    query getRunnerSummary(
      $first: Int!
      $after: String
      $type: CiRunnerType
    ) {
      runners(first: $first, after: $after, type: $type) {
        nodes {
          id
          jobExecutionStatus
          version
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
  let currentVersionCounts = new Map();
  let currentRunnerVersions = new Map();
  let currentRunnerType = null;
  let activeJobStatusFilter = null;
  let activeVersionFilter = null;
  let refreshTimer = 0;
  let refreshPromise = null;

  function addStyle() {
    const style = document.createElement('style');

    style.textContent = `
      #${DIVIDER_ID},
      #${VERSION_DIVIDER_ID} {
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

      .vm-runner-summary-filter {
        border-radius: var(--gl-border-radius-lg, 0.5rem);
        cursor: pointer;
        outline-offset: 0.25rem;
      }

      .vm-runner-summary-filter:hover,
      .vm-runner-summary-filter:focus-visible,
      .vm-runner-summary-filter[aria-pressed="true"] {
        outline: 2px solid var(--gl-focus-ring-outer-color, #1f75cb);
      }

      .vm-runner-online-badge {
        background-color: transparent !important;
        border: 1px solid var(--gl-status-success-border-color, #108548) !important;
        box-shadow: none !important;
        color: var(--gl-status-success-text-color, #0a7f42) !important;
      }

      .vm-runner-online-badge .gl-badge-icon,
      .vm-runner-online-badge svg {
        display: none !important;
      }

      .vm-runner-job-badge {
        align-items: center;
        border-color: transparent !important;
        box-shadow: none !important;
        display: inline-flex !important;
        gap: 0.5rem;
      }

      .vm-runner-job-badge::before {
        background-color: currentColor;
        border-radius: 50%;
        content: '';
        flex: none;
        height: 1rem;
        width: 1rem;
      }

      .vm-runner-job-badge .gl-badge-icon,
      .vm-runner-job-badge svg {
        display: none !important;
      }

      .vm-runner-running-badge {
        background-color: var(--gl-status-info-background-color, #cbe2f9) !important;
        color: var(--gl-status-info-text-color, #0b5cad) !important;
      }

      .vm-runner-idle-badge {
        background-color: var(--gl-status-neutral-background-color, #ececef) !important;
        color: var(--gl-text-color-default, #333238) !important;
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

  function normalizeVersion(version) {
    return String(version ?? '').trim() || UNKNOWN_VERSION;
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

  function getRowVersion(row) {
    const rowTestId = row.dataset.testid ?? '';
    const runnerId = rowTestId.replace(/^runner-row-/, '');

    if (currentRunnerVersions.has(runnerId)) {
      return currentRunnerVersions.get(runnerId);
    }

    const versionMatch = row.textContent.match(/\bVersion\s+([^\s·]+)/i);

    return versionMatch ? normalizeVersion(versionMatch[1]) : UNKNOWN_VERSION;
  }

  function getRowStatusBadge(row, status) {
    const statusElement = [...row.querySelectorAll('span')].find(
      (element) => element.textContent.trim().toUpperCase() === status,
    );

    return (
      statusElement?.closest('.gl-badge') ??
      statusElement?.closest('.badge') ??
      statusElement
    );
  }

  function updateRowStatusBadges(row) {
    const onlineBadge = getRowStatusBadge(row, 'ONLINE');
    const idleBadge = getRowStatusBadge(row, 'IDLE');
    const runningBadge = getRowStatusBadge(row, 'RUNNING');

    if (onlineBadge) {
      onlineBadge.classList.remove(
        'vm-runner-job-badge',
        'vm-runner-idle-badge',
        'vm-runner-running-badge',
      );
      onlineBadge.classList.add('gl-badge-outlined', 'vm-runner-online-badge');
    }

    for (const [badge, statusClass] of [
      [idleBadge, 'vm-runner-idle-badge'],
      [runningBadge, 'vm-runner-running-badge'],
    ]) {
      if (!badge) {
        continue;
      }

      badge.classList.remove('gl-badge-outlined');
      badge.classList.remove(
        'vm-runner-online-badge',
        statusClass === 'vm-runner-idle-badge'
          ? 'vm-runner-running-badge'
          : 'vm-runner-idle-badge',
      );
      badge.classList.add('vm-runner-job-badge', statusClass);
    }
  }

  function applyRunnerFilter() {
    const rows = document.querySelectorAll(
      '[data-testid="runner-list"] tr[data-testid^="runner-row-"]',
    );

    for (const row of rows) {
      updateRowStatusBadges(row);

      const shouldHide =
        (activeJobStatusFilter && getRowJobStatus(row) !== activeJobStatusFilter) ||
        (activeVersionFilter && getRowVersion(row) !== activeVersionFilter);

      row.classList.toggle('vm-runner-job-status-filtered', Boolean(shouldHide));
    }
  }

  function updateFilterControls() {
    const jobStatusStats = document.querySelectorAll('[data-job-status-filter]');

    for (const stat of jobStatusStats) {
      const status = stat.dataset.jobStatusFilter;
      const isActive = status === activeJobStatusFilter;
      const label = status === 'RUNNING' ? 'Running' : 'Idle';

      stat.setAttribute('aria-pressed', String(isActive));
      stat.setAttribute(
        'aria-label',
        isActive ? `取消 ${label} 筛选` : `只显示 ${label} runner`,
      );
      stat.setAttribute(
        'title',
        isActive ? `取消 ${label} 筛选` : `只显示 ${label} runner`,
      );
    }

    const versionStats = document.querySelectorAll('[data-runner-version-filter]');

    for (const stat of versionStats) {
      const version = stat.dataset.runnerVersionFilter;
      const isActive = version === activeVersionFilter;
      const action = isActive ? '取消版本筛选' : `只显示 ${version} 版本的 runner`;

      stat.setAttribute('aria-pressed', String(isActive));
      stat.setAttribute('aria-label', action);
      stat.setAttribute('title', action);
    }
  }

  function toggleRunnerFilter(status) {
    activeJobStatusFilter = activeJobStatusFilter === status ? null : status;
    updateFilterControls();
    applyRunnerFilter();
  }

  function toggleVersionFilter(version) {
    activeVersionFilter = activeVersionFilter === version ? null : version;
    updateFilterControls();
    applyRunnerFilter();
  }

  function makeStatFilterable(stat, status) {
    stat.classList.add('vm-runner-summary-filter');
    stat.dataset.jobStatusFilter = status;
    stat.setAttribute('role', 'button');
    stat.setAttribute('tabindex', '0');
    stat.addEventListener('click', (event) => {
      event.preventDefault();
      toggleRunnerFilter(status);
    });
    stat.addEventListener('keydown', (event) => {
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
    makeStatFilterable(stat, id === RUNNING_STAT_ID ? 'RUNNING' : 'IDLE');

    return stat;
  }

  function createVersionStat(source, version, count) {
    const stat = source.cloneNode(true);
    const titleElement = getTitleElement(stat);
    const valueElement = getValueElement(stat);
    const icon =
      stat.querySelector('[data-testid="meta-icon"]') ??
      [...stat.querySelectorAll('svg')].at(-1);

    stat.removeAttribute('id');
    stat.removeAttribute('data-testid');
    stat.classList.add(VERSION_STAT_CLASS, 'vm-runner-summary-filter');
    stat.dataset.runnerVersionFilter = version;
    stat.setAttribute('role', 'button');
    stat.setAttribute('tabindex', '0');

    setTextIfChanged(titleElement, version);
    setTextIfChanged(valueElement, formatCount(count));
    icon?.remove();

    stat.addEventListener('click', (event) => {
      event.preventDefault();
      toggleVersionFilter(version);
    });
    stat.addEventListener('keydown', (event) => {
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        toggleVersionFilter(version);
      }
    });

    return stat;
  }

  function getSortedVersionCounts() {
    return [...currentVersionCounts.entries()].sort(([left], [right]) => {
      if (left === right) {
        return 0;
      }

      if (left === UNKNOWN_VERSION) {
        return 1;
      }

      if (right === UNKNOWN_VERSION) {
        return -1;
      }

      return VERSION_COLLATOR.compare(right, left);
    });
  }

  function updateVersionSummary(summary, source) {
    const expectedVersionCounts = getSortedVersionCounts();
    const renderedStats = [...summary.querySelectorAll(`.${VERSION_STAT_CLASS}`)];
    const canReuseRenderedStats =
      renderedStats.length === expectedVersionCounts.length &&
      renderedStats.every(
        (stat, index) =>
          stat.dataset.runnerVersionFilter === expectedVersionCounts[index][0],
      );

    if (canReuseRenderedStats) {
      for (const [index, [, count]] of expectedVersionCounts.entries()) {
        setTextIfChanged(getValueElement(renderedStats[index]), formatCount(count));
      }

      return;
    }

    for (const stat of renderedStats) {
      stat.remove();
    }

    summary.append(
      ...expectedVersionCounts.map(([version, count]) =>
        createVersionStat(source, version, count),
      ),
    );
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
    const versionStatSource = onlineStat ?? builtInStats[0];

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

      const versionDivider = document.createElement('div');

      versionDivider.id = VERSION_DIVIDER_ID;
      versionDivider.setAttribute('aria-hidden', 'true');
      summary.append(versionDivider);
    }

    let versionDivider = summary.querySelector(`#${VERSION_DIVIDER_ID}`);

    if (!versionDivider) {
      versionDivider = document.createElement('div');
      versionDivider.id = VERSION_DIVIDER_ID;
      versionDivider.setAttribute('aria-hidden', 'true');
      summary.append(versionDivider);
    }

    updateVersionSummary(summary, versionStatSource);
    versionDivider.hidden = currentVersionCounts.size === 0;

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

  async function requestRunnerSummary(type, after = null) {
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
        query: RUNNER_SUMMARY_QUERY,
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

  async function loadSummary(type) {
    const counts = { idle: 0, running: 0 };
    const statuses = new Map();
    const versionCounts = new Map();
    const versions = new Map();
    let after = null;

    do {
      const runners = await requestRunnerSummary(type, after);

      for (const runner of runners.nodes ?? []) {
        const status = normalizeJobStatus(runner.jobExecutionStatus);
        const version = normalizeVersion(runner.version);
        const runnerId = getRunnerId(runner.id);

        statuses.set(runnerId, status);
        versions.set(runnerId, version);
        versionCounts.set(version, (versionCounts.get(version) ?? 0) + 1);

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

    return { counts, statuses, versionCounts, versions };
  }

  async function refreshSummary() {
    if (refreshPromise || document.hidden) {
      return refreshPromise;
    }

    const runnerType = getRunnerType();
    currentRunnerType = runnerType;
    refreshPromise = loadSummary(runnerType)
      .then(({ counts, statuses, versionCounts, versions }) => {
        if (runnerType === getRunnerType()) {
          currentCounts = counts;
          currentRunnerStatuses = statuses;
          currentVersionCounts = versionCounts;
          currentRunnerVersions = versions;

          if (activeVersionFilter && !currentVersionCounts.has(activeVersionFilter)) {
            activeVersionFilter = null;
          }

          ensureSummary();
          applyRunnerFilter();
        }
      })
      .catch((error) => {
        console.error('[GitLab Runner 汇总]', error);
      })
      .finally(() => {
        refreshPromise = null;

        if (runnerType !== getRunnerType()) {
          void refreshSummary();
        }
      });

    return refreshPromise;
  }

  function refreshIfRunnerTypeChanged() {
    if (getRunnerType() !== currentRunnerType) {
      currentCounts = { idle: null, running: null };
      currentRunnerStatuses = new Map();
      currentVersionCounts = new Map();
      currentRunnerVersions = new Map();
      ensureSummary();
      applyRunnerFilter();
      void refreshSummary();
    }
  }

  function start() {
    ensureSummary();
    void refreshSummary();

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
      void refreshSummary();
    }, REFRESH_INTERVAL_MS);

    window.addEventListener('popstate', refreshIfRunnerTypeChanged);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshIfRunnerTypeChanged();
        void refreshSummary();
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
