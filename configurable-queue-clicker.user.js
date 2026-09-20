// ==UserScript==
// @name         Configurable Queue Clicker
// @namespace    https://github.com/your-username/configurable-queue-clicker
// @version      1.0.0
// @description  Configurable userscript that repeatedly clicks a trigger until a configured success control appears.
// @match        *://*/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_PREFIX = 'configurableQueueClicker.v1.';
  const DEFAULTS = {
    sitePattern: '',
    triggerText: 'Join Queue',
    successText: 'Leave Queue',
    intervalSeconds: 1,
    jitterSeconds: 0,
    refreshEnabled: false,
    refreshSeconds: 30,
    panelX: null,
    panelY: null,
    running: false,
    clickCount: 0
  };

  const LIMITS = {
    intervalSeconds: { min: 0.25, max: 3600 },
    jitterSeconds: { min: 0, max: 600 },
    refreshSeconds: { min: 5, max: 86400 }
  };

  const read = (key, fallback) => {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return fallback;
    if (typeof fallback === 'boolean') return raw === 'true';
    if (typeof fallback === 'number') {
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    }
    return raw;
  };

  const write = (key, value) => {
    localStorage.setItem(STORAGE_PREFIX + key, String(value));
  };

  const settings = {
    sitePattern: read('sitePattern', DEFAULTS.sitePattern),
    triggerText: read('triggerText', DEFAULTS.triggerText),
    successText: read('successText', DEFAULTS.successText),
    intervalSeconds: read('intervalSeconds', DEFAULTS.intervalSeconds),
    jitterSeconds: read('jitterSeconds', DEFAULTS.jitterSeconds),
    refreshEnabled: read('refreshEnabled', DEFAULTS.refreshEnabled),
    refreshSeconds: read('refreshSeconds', DEFAULTS.refreshSeconds),
    panelX: read('panelX', DEFAULTS.panelX),
    panelY: read('panelY', DEFAULTS.panelY),
    running: read('running', DEFAULTS.running),
    clickCount: read('clickCount', DEFAULTS.clickCount)
  };

  let running = settings.running;
  let successDetected = false;
  let clickCount = settings.clickCount;
  let clickTimer = null;
  let refreshTimer = null;
  let countdownTimer = null;
  let pageObserver = null;
  let nextClickAt = 0;
  let nextRefreshAt = 0;
  let audioContext = null;

  const ui = {};

  const normalize = (text) =>
    (text || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const formatSeconds = (milliseconds) =>
    `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;

  const isValid = (value, range) =>
    Number.isFinite(value) && value >= range.min && value <= range.max;

  function wildcardToRegex(pattern) {
    const escaped = pattern
      .trim()
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    return new RegExp(`^${escaped}$`, 'i');
  }

  function siteMatchesPattern() {
    const pattern = settings.sitePattern.trim();

    if (!pattern) {
      return true;
    }

    try {
      return wildcardToRegex(pattern).test(location.href);
    } catch (_) {
      return false;
    }
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function findControlByText(text, requireEnabled = true) {
    const target = normalize(text);

    if (!target) {
      return null;
    }

    const controls = document.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"], a'
    );

    for (const control of controls) {
      const label = normalize(
        control.innerText ||
        control.value ||
        control.getAttribute('aria-label') ||
        control.title
      );

      const disabled =
        control.disabled ||
        control.getAttribute('aria-disabled') === 'true';

      if (
        isVisible(control) &&
        (!requireEnabled || !disabled) &&
        label.includes(target)
      ) {
        return control;
      }
    }

    return null;
  }

  function findTriggerButton() {
    return findControlByText(settings.triggerText, true);
  }

  function successControlVisible() {
    return Boolean(findControlByText(settings.successText, false));
  }

  function log(message) {
    if (!ui.log) {
      return;
    }

    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    ui.log.prepend(entry);
  }

  function getAudioContext() {
    if (!audioContext) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (AudioContextClass) {
        audioContext = new AudioContextClass();
      }
    }

    return audioContext;
  }

  function unlockAudio() {
    const context = getAudioContext();

    if (!context) {
      ui.audioStatus.textContent =
        'Audio is unavailable in this browser.';
      return;
    }

    context.resume().then(() => {
      ui.audioStatus.textContent = 'Audio enabled.';
    }).catch(() => {
      ui.audioStatus.textContent =
        'Audio could not be enabled. Check tab and site sound permissions.';
    });
  }

  function playTone(startAfter, frequency, duration) {
    const context = getAudioContext();

    if (!context || context.state !== 'running') {
      return false;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    gain.gain.setValueAtTime(
      0.0001,
      context.currentTime + startAfter
    );

    gain.gain.exponentialRampToValueAtTime(
      0.18,
      context.currentTime + startAfter + 0.01
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + startAfter + duration
    );

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime + startAfter);
    oscillator.stop(context.currentTime + startAfter + duration + 0.02);

    return true;
  }

  function playSuccessTone() {
    const first = playTone(0, 784, 0.14);
    const second = playTone(0.18, 988, 0.18);
    return first && second;
  }

  function speakSuccess() {
    const message = 'Success. The queue has been joined successfully.';

    if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      try {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onstart = () => {
          ui.audioStatus.textContent = 'Speaking success message.';
        };

        utterance.onerror = () => {
          ui.audioStatus.textContent =
            'Voice message unavailable. Success tone played instead.';
        };

        window.speechSynthesis.speak(utterance);
      } catch (_) {
        ui.audioStatus.textContent =
          'Voice message unavailable. Success tone played instead.';
      }
    }

    const tonePlayed = playSuccessTone();

    if (!tonePlayed && !('speechSynthesis' in window)) {
      ui.audioStatus.textContent =
        'Audio blocked. Click Enable/Test Audio before starting.';
    }
  }

  function clearTimers() {
    clearTimeout(clickTimer);
    clearTimeout(refreshTimer);
    clearInterval(countdownTimer);

    clickTimer = null;
    refreshTimer = null;
    countdownTimer = null;
    nextClickAt = 0;
    nextRefreshAt = 0;
  }

  function updateCountdowns() {
    if (!running) {
      ui.nextClick.textContent = '—';
      ui.nextRefresh.textContent = 'Off';
      return;
    }

    ui.nextClick.textContent = nextClickAt
      ? formatSeconds(nextClickAt - Date.now())
      : '—';

    ui.nextRefresh.textContent =
      settings.refreshEnabled && nextRefreshAt
        ? formatSeconds(nextRefreshAt - Date.now())
        : 'Off';
  }

  function stop(reason = 'Stopped.') {
    running = false;
    write('running', false);
    clearTimers();

    ui.start.textContent = 'Start';
    ui.status.textContent = reason;

    updateCountdowns();
    log(reason);
  }

  function showSuccessPopup() {
    ui.successPopup.hidden = false;
    ui.successPopup.focus();
  }

  function handleSuccess() {
    if (successDetected) {
      return;
    }

    successDetected = true;

    stop(`Success detected: “${settings.successText}”. Timers stopped.`);

    pageObserver?.disconnect();

    ui.successTitle.textContent = '✓ Success';
    ui.successMessage.textContent =
      `“${settings.successText}” was detected. The queue has been joined successfully and all timers have stopped.`;

    showSuccessPopup();
    speakSuccess();

    log(`SUCCESS: “${settings.successText}” was detected.`);
  }

  function checkForSuccess() {
    if (
      running &&
      !successDetected &&
      successControlVisible()
    ) {
      handleSuccess();
    }
  }

  function getClickDelay() {
    const base = settings.intervalSeconds * 1000;
    const jitter = settings.jitterSeconds * 1000;

    const variance = jitter
      ? (Math.random() * 2 - 1) * jitter
      : 0;

    return Math.max(250, base + variance);
  }

  function scheduleClick() {
    if (!running || successDetected) {
      return;
    }

    const delay = getClickDelay();

    nextClickAt = Date.now() + delay;
    updateCountdowns();

    clickTimer = setTimeout(() => {
      clickTrigger();
      scheduleClick();
    }, delay);
  }

  function scheduleRefresh() {
    if (
      !running ||
      successDetected ||
      !settings.refreshEnabled
    ) {
      return;
    }

    const delay = settings.refreshSeconds * 1000;

    nextRefreshAt = Date.now() + delay;
    updateCountdowns();

    refreshTimer = setTimeout(() => {
      if (!successDetected) {
        log(
          `Refreshing page after ${settings.refreshSeconds} seconds.`
        );

        location.reload();
      }
    }, delay);
  }

  function clickTrigger() {
    if (!running || successDetected) {
      return;
    }

    checkForSuccess();

    if (successDetected) {
      return;
    }

    const trigger = findTriggerButton();

    if (!trigger) {
      ui.status.textContent =
        `Waiting for an enabled “${settings.triggerText}” control…`;
      return;
    }

    trigger.click();

    clickCount += 1;
    write('clickCount', clickCount);

    ui.count.textContent = String(clickCount);
    ui.status.textContent =
      `Clicked “${settings.triggerText}”; waiting for “${settings.successText}”…`;

    log(`Clicked “${settings.triggerText}” (${clickCount}).`);

    setTimeout(checkForSuccess, 100);
    setTimeout(checkForSuccess, 500);
    setTimeout(checkForSuccess, 1500);
  }

  function observePage() {
    pageObserver?.disconnect();

    pageObserver = new MutationObserver(checkForSuccess);

    pageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'disabled']
    });
  }

  function saveConfigurationFromPanel() {
    const sitePattern = ui.sitePattern.value.trim();
    const triggerText = ui.triggerText.value.trim();
    const successText = ui.successText.value.trim();
    const intervalSeconds = Number(ui.interval.value);
    const jitterSeconds = Number(ui.jitter.value);
    const refreshSeconds = Number(ui.refreshSeconds.value);

    if (!triggerText) {
      ui.status.textContent = 'Enter Trigger Text.';
      return false;
    }

    if (!successText) {
      ui.status.textContent = 'Enter Success Text.';
      return false;
    }

    if (!isValid(intervalSeconds, LIMITS.intervalSeconds)) {
      ui.status.textContent =
        `Click timer must be ${LIMITS.intervalSeconds.min}–${LIMITS.intervalSeconds.max} seconds.`;
      return false;
    }

    if (!isValid(jitterSeconds, LIMITS.jitterSeconds)) {
      ui.status.textContent =
        `Jitter must be ${LIMITS.jitterSeconds.min}–${LIMITS.jitterSeconds.max} seconds.`;
      return false;
    }

    if (
      ui.refreshEnabled.checked &&
      !isValid(refreshSeconds, LIMITS.refreshSeconds)
    ) {
      ui.status.textContent =
        `Refresh timer must be ${LIMITS.refreshSeconds.min}–${LIMITS.refreshSeconds.max} seconds.`;
      return false;
    }

    settings.sitePattern = sitePattern;
    settings.triggerText = triggerText;
    settings.successText = successText;
    settings.intervalSeconds = intervalSeconds;
    settings.jitterSeconds = jitterSeconds;
    settings.refreshEnabled = ui.refreshEnabled.checked;
    settings.refreshSeconds = refreshSeconds;

    write('sitePattern', sitePattern);
    write('triggerText', triggerText);
    write('successText', successText);
    write('intervalSeconds', intervalSeconds);
    write('jitterSeconds', jitterSeconds);
    write('refreshEnabled', settings.refreshEnabled);
    write('refreshSeconds', refreshSeconds);

    return true;
  }

  function start(resume = false) {
    if (!resume && !saveConfigurationFromPanel()) {
      return;
    }

    if (!siteMatchesPattern()) {
      ui.status.textContent =
        'This page does not match the configured Site URL Pattern.';
      return;
    }

    clearTimers();

    successDetected = false;
    running = true;

    write('running', true);

    ui.successPopup.hidden = true;
    ui.start.textContent = 'Restart';

    ui.status.textContent = resume
      ? `Resumed after refresh. Clicking “${settings.triggerText}”.`
      : `Running. Clicking “${settings.triggerText}”.`;

    log(
      resume
        ? 'Resumed automatically after page refresh.'
        : `Started. Trigger: “${settings.triggerText}”. Success: “${settings.successText}”.`
    );

    observePage();
    checkForSuccess();

    if (!successDetected) {
      clickTrigger();
      scheduleClick();
      scheduleRefresh();
      countdownTimer = setInterval(updateCountdowns, 100);
      updateCountdowns();
    }
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    function constrain(left, top) {
      return {
        left: Math.min(
          Math.max(0, left),
          Math.max(0, window.innerWidth - panel.offsetWidth)
        ),
        top: Math.min(
          Math.max(0, top),
          Math.max(0, window.innerHeight - panel.offsetHeight)
        )
      };
    }

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) {
        return;
      }

      const rect = panel.getBoundingClientRect();

      dragging = true;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;

      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }

      const position = constrain(
        event.clientX - offsetX,
        event.clientY - offsetY
      );

      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
    });

    function savePosition() {
      if (!dragging) {
        return;
      }

      dragging = false;

      const rect = panel.getBoundingClientRect();

      settings.panelX = Math.round(rect.left);
      settings.panelY = Math.round(rect.top);

      write('panelX', settings.panelX);
      write('panelY', settings.panelY);
    }

    handle.addEventListener('pointerup', savePosition);
    handle.addEventListener('pointercancel', savePosition);
  }

  function buildUi() {
    const panel = document.createElement('section');

    panel.id = 'configurable-queue-clicker';

    if (
      settings.panelX !== null &&
      settings.panelY !== null
    ) {
      panel.style.left = `${settings.panelX}px`;
      panel.style.top = `${settings.panelY}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    panel.innerHTML = `
      <style>
        #configurable-queue-clicker {
          position: fixed;
          z-index: 2147483646;
          right: 16px;
          bottom: 16px;
          width: 390px;
          padding: 14px;
          color: #f7f7f7;
          background: #16181d;
          border: 1px solid #41454f;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, .4);
          font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        #configurable-queue-clicker * {
          box-sizing: border-box;
        }

        #configurable-queue-clicker .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: -14px -14px 10px;
          padding: 12px 14px;
          border-bottom: 1px solid #41454f;
          cursor: move;
          user-select: none;
          touch-action: none;
        }

        #configurable-queue-clicker h2 {
          margin: 0;
          font-size: 16px;
        }

        #configurable-queue-clicker .close {
          border: 0;
          border-radius: 5px;
          color: #fff;
          background: #4b5563;
          cursor: pointer;
          padding: 0 8px;
          font-size: 20px;
          line-height: 26px;
        }

        #configurable-queue-clicker label {
          display: block;
          margin: 10px 0 5px;
          color: #e5e7eb;
        }

        #configurable-queue-clicker input[type="text"],
        #configurable-queue-clicker input[type="number"] {
          width: 100%;
          padding: 8px;
          border: 1px solid #555b68;
          border-radius: 6px;
          color: #fff;
          background: #252832;
        }

        #configurable-queue-clicker .check {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 12px;
          cursor: pointer;
        }

        #configurable-queue-clicker .check input {
          width: 16px;
          height: 16px;
        }

        #configurable-queue-clicker .row {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          flex-wrap: wrap;
        }

        #configurable-queue-clicker button:not(.close) {
          cursor: pointer;
          padding: 8px 10px;
          border: 0;
          border-radius: 6px;
          color: #fff;
          background: #2563eb;
          font-weight: 600;
        }

        #configurable-queue-clicker button.secondary {
          background: #4b5563;
        }

        #configurable-queue-clicker button.audio {
          background: #7c3aed;
        }

        #configurable-queue-clicker .hint {
          margin-top: 4px;
          color: #9ca3af;
          font-size: 12px;
        }

        #configurable-queue-clicker .stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 12px;
          margin-top: 12px;
          padding: 9px;
          background: #20232b;
          border-radius: 6px;
          color: #d1d5db;
        }

        #configurable-queue-clicker .stats strong {
          color: #fff;
        }

        #configurable-queue-clicker #cqc-status {
          min-height: 20px;
          margin-top: 10px;
          color: #facc15;
        }

        #configurable-queue-clicker #cqc-audio-status {
          min-height: 18px;
          margin-top: 5px;
          color: #c4b5fd;
          font-size: 12px;
        }

        #configurable-queue-clicker #cqc-log {
          height: 100px;
          overflow: auto;
          margin-top: 10px;
          padding: 8px;
          background: #0e1014;
          border-radius: 6px;
          color: #d1d5db;
          font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        }

        #cqc-success-popup {
          position: fixed;
          z-index: 2147483647;
          left: 50%;
          top: 50%;
          width: min(440px, calc(100vw - 32px));
          transform: translate(-50%, -50%);
          padding: 22px;
          color: #ecfdf5;
          background: #14532d;
          border: 3px solid #4ade80;
          border-radius: 12px;
          box-shadow: 0 16px 50px rgba(0, 0, 0, .55);
          text-align: center;
          font: 16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        #cqc-success-popup h3 {
          margin: 0 0 8px;
          font-size: 21px;
        }

        #cqc-success-popup p {
          margin: 0 0 16px;
        }

        #cqc-success-popup button {
          cursor: pointer;
          padding: 9px 16px;
          border: 0;
          border-radius: 6px;
          color: #fff;
          background: #374151;
          font-weight: 700;
        }
      </style>

      <div class="header" id="cqc-drag-handle">
        <h2>Configurable Queue Clicker</h2>
        <button id="cqc-close" class="close" type="button" aria-label="Close panel">×</button>
      </div>

      <label for="cqc-site-pattern">Site URL Pattern</label>
      <input id="cqc-site-pattern" type="text" placeholder="https://example.com/*" value="${settings.sitePattern}">

      <label for="cqc-trigger-text">Trigger Text</label>
      <input id="cqc-trigger-text" type="text" value="${settings.triggerText}">

      <label for="cqc-success-text">Success Text</label>
      <input id="cqc-success-text" type="text" value="${settings.successText}">

      <label for="cqc-interval">Click Timer (seconds)</label>
      <input id="cqc-interval" type="number" min="0.25" max="3600" step="0.25" value="${settings.intervalSeconds}">

      <label for="cqc-jitter">Jitter (± seconds)</label>
      <input id="cqc-jitter" type="number" min="0" max="600" step="0.25" value="${settings.jitterSeconds}">

      <div class="hint">
        Jitter changes click timing only. It does not affect page refresh timing.
      </div>

      <label class="check" for="cqc-refresh-enabled">
        <input id="cqc-refresh-enabled" type="checkbox" ${settings.refreshEnabled ? 'checked' : ''}>
        Refresh page automatically
      </label>

      <label for="cqc-refresh-seconds">Page Refresh Timer (seconds)</label>
      <input id="cqc-refresh-seconds" type="number" min="5" max="86400" step="1" value="${settings.refreshSeconds}">

      <div class="row">
        <button id="cqc-start" type="button">${running ? 'Restart' : 'Start'}</button>
        <button id="cqc-stop" class="secondary" type="button">Stop</button>
        <button id="cqc-reset" class="secondary" type="button">Reset Count</button>
      </div>

      <div class="row">
        <button id="cqc-enable-audio" class="audio" type="button">Enable/Test Audio</button>
      </div>

      <div id="cqc-audio-status">
        Click Enable/Test Audio once before starting.
      </div>

      <div class="stats">
        <div>Clicks: <strong id="cqc-count">${clickCount}</strong></div>
        <div>Next Click: <strong id="cqc-next-click">—</strong></div>
        <div>Refresh: <strong id="cqc-next-refresh">Off</strong></div>
      </div>

      <div id="cqc-status">
        ${running ? 'Resuming after page refresh…' : 'Ready.'}
      </div>

      <div id="cqc-log" aria-live="polite"></div>
    `;

    const successPopup = document.createElement('section');

    successPopup.id = 'cqc-success-popup';
    successPopup.hidden = true;
    successPopup.tabIndex = -1;
    successPopup.setAttribute('role', 'alertdialog');
    successPopup.setAttribute('aria-modal', 'true');
    successPopup.setAttribute('aria-label', 'Success notification');

    successPopup.innerHTML = `
      <h3 id="cqc-success-title">✓ Success</h3>
      <p id="cqc-success-message"></p>
      <button id="cqc-success-dismiss" type="button">Dismiss</button>
    `;

    document.documentElement.append(panel, successPopup);

    ui.root = panel;
    ui.sitePattern = panel.querySelector('#cqc-site-pattern');
    ui.triggerText = panel.querySelector('#cqc-trigger-text');
    ui.successText = panel.querySelector('#cqc-success-text');
    ui.interval = panel.querySelector('#cqc-interval');
    ui.jitter = panel.querySelector('#cqc-jitter');
    ui.refreshEnabled = panel.querySelector('#cqc-refresh-enabled');
    ui.refreshSeconds = panel.querySelector('#cqc-refresh-seconds');
    ui.start = panel.querySelector('#cqc-start');
    ui.stop = panel.querySelector('#cqc-stop');
    ui.reset = panel.querySelector('#cqc-reset');
    ui.close = panel.querySelector('#cqc-close');
    ui.dragHandle = panel.querySelector('#cqc-drag-handle');
    ui.enableAudio = panel.querySelector('#cqc-enable-audio');
    ui.audioStatus = panel.querySelector('#cqc-audio-status');
    ui.count = panel.querySelector('#cqc-count');
    ui.nextClick = panel.querySelector('#cqc-next-click');
    ui.nextRefresh = panel.querySelector('#cqc-next-refresh');
    ui.status = panel.querySelector('#cqc-status');
    ui.log = panel.querySelector('#cqc-log');
    ui.successPopup = successPopup;
    ui.successTitle = successPopup.querySelector('#cqc-success-title');
    ui.successMessage = successPopup.querySelector('#cqc-success-message');
    ui.dismissSuccess = successPopup.querySelector('#cqc-success-dismiss');

    function updateRefreshInput() {
      ui.refreshSeconds.disabled = !ui.refreshEnabled.checked;
      ui.refreshSeconds.style.opacity =
        ui.refreshEnabled.checked ? '1' : '.5';
    }

    updateRefreshInput();

    ui.refreshEnabled.addEventListener('change', updateRefreshInput);

    ui.start.addEventListener('click', () => {
      unlockAudio();
      start(false);
    });

    ui.stop.addEventListener('click', () => {
      stop('Stopped by user.');
    });

    ui.reset.addEventListener('click', () => {
      clickCount = 0;
      write('clickCount', 0);
      ui.count.textContent = '0';
      log('Click count reset.');
    });

    ui.enableAudio.addEventListener('click', () => {
      unlockAudio();

      setTimeout(() => {
        const tonePlayed = playSuccessTone();
        const context = getAudioContext();

        ui.audioStatus.textContent =
          context && context.state === 'running' && tonePlayed
            ? 'Audio enabled. You should have heard a two-tone test.'
            : 'Audio is blocked. Check browser/site mute settings and try again.';
      }, 50);
    });

    ui.dismissSuccess.addEventListener('click', () => {
      ui.successPopup.hidden = true;

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    });

    ui.close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      stop('Panel closed by user.');
      pageObserver?.disconnect();

      panel.remove();
    });

    makeDraggable(panel, ui.dragHandle);

    log(
      running
        ? 'Panel loaded. Resuming automatically after refresh.'
        : 'Ready. Configure the site, trigger, and success text.'
    );
  }

  buildUi();

  if (running) {
    setTimeout(() => start(true), 600);
  }
})();
