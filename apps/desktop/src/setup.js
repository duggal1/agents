(() => {
  const bridge = window.rakazoSetup;
  document.documentElement.dataset.platform = bridge?.platform ?? "browser";

  const form = document.getElementById("setup");
  const serverUrl = document.getElementById("server-url");
  const e2bKey = document.getElementById("e2b-key");
  const panelNew = document.getElementById("panel-new");
  const panelExisting = document.getElementById("panel-existing");
  const stackSection = document.getElementById("stack");
  const stackPhase = document.getElementById("stack-phase");
  const stackOutput = document.getElementById("stack-output");
  const stackDetail = document.getElementById("stack-detail");
  const stackDetails = document.getElementById("stack-details");
  const stackProgress = document.getElementById("stack-progress");
  const stackProgressFill = document.getElementById("stack-progress-fill");
  const status = document.getElementById("status");
  const loader = document.getElementById("loader");
  const loaderLabel = document.getElementById("loader-label");
  const checkButton = document.getElementById("check");
  const freshButton = document.getElementById("start-fresh");
  const continueButton = document.getElementById("continue");

  const STACK_POLL_MS = 1000;
  const PHASE_LABELS = {
    "starting-database": "Starting local database",
    migrating: "Moving your previous data",
    "starting-api": "Starting app services",
    "starting-worker": "Starting background jobs",
    ready: "Sapphire is ready.",
    degraded: "Running with a warning",
    stopping: "Stopping",
  };
  const TERMINAL_PHASES = new Set(["idle", "ready", "failed"]);
  const PHASE_PROGRESS = {
    "starting-database": 0.25,
    migrating: 0.5,
    "starting-api": 0.7,
    "starting-worker": 0.85,
    degraded: 0.9,
    ready: 1,
  };

  let defaultLocalUrl = "";
  let stackPolling = false;
  let lastStack = null;
  let lastProgress = 0;
  let detailsOpen = false;
  /** Set when a failure opened the output; a retry closes it again, a person's own click does not. */
  let detailsOpenedByFailure = false;
  /** Resolves the poll wait early when the main process pushes a new state. */
  let wakePoll = null;

  function selectedMode() {
    const checked = form.querySelector('input[name="mode"]:checked');
    return checked === null ? "new" : checked.value;
  }

  function setStatus(message, tone) {
    status.textContent = message;
    if (tone === undefined) status.removeAttribute("data-tone");
    else status.setAttribute("data-tone", tone);
    // Re-run the blur cross-fade so every result still animates.
    status.classList.remove("swap");
    void status.offsetWidth;
    status.classList.add("swap");
  }

  /** Terminal loader: present-participle label, no trailing ellipsis. */
  function setLoader(label) {
    if (label === null) {
      loader.hidden = true;
      return;
    }
    loaderLabel.textContent = label;
    loader.hidden = false;
  }

  function setBusy(busy) {
    checkButton.disabled = busy;
    continueButton.disabled = busy;
  }

  /** A save in flight cannot be cancelled, so the choice it commits must not change under it. */
  function lockMode(locked) {
    for (const input of form.querySelectorAll('input[name="mode"]')) input.disabled = locked;
  }

  function syncPanels() {
    const mode = selectedMode();
    panelNew.hidden = mode !== "new";
    panelExisting.hidden = mode === "new";
    checkButton.hidden = mode === "new";
    freshButton.hidden = true;
    if (mode !== "new") continueButton.textContent = "Continue";
    setStatus("");
  }

  function progressFor(stack) {
    return PHASE_PROGRESS[stack.phase] ?? 0;
  }

  function renderProgress(stack) {
    const running = stack.phase in PHASE_PROGRESS;
    stackProgress.hidden = !running;
    if (!running) {
      lastProgress = 0;
      stackProgressFill.style.width = "0%";
      return;
    }
    // A retry restarts at its phase; otherwise the bar only ever moves forward.
    lastProgress =
      stack.phase === "starting-database"
        ? progressFor(stack)
        : Math.max(lastProgress, progressFor(stack));
    const percent = (lastProgress * 100).toFixed(1);
    stackProgressFill.style.width = `${percent}%`;
    stackProgress.setAttribute("aria-valuenow", percent);
  }

  function renderDetails(stack) {
    // The backend reports one actionable sentence while it works; surface it
    // under the phase label so a data copy never looks stalled.
    const detail =
      (stack.phase === "migrating" || stack.phase === "degraded") && stack.message
        ? stack.message
        : "";
    stackDetail.textContent = detail;

    // A new attempt clears the output, so drop an expansion the person did not ask for.
    if (stack.phase === "starting-database" && detailsOpenedByFailure) {
      detailsOpen = false;
      detailsOpenedByFailure = false;
    }
    const hasOutput = stack.output.length > 0;
    // A failure asks the person to read the output, so open it for them.
    if (stack.phase === "failed" && hasOutput && !detailsOpen) {
      detailsOpen = true;
      detailsOpenedByFailure = true;
    }
    // Progressive disclosure: the technical-details toggle appears only while
    // it is useful — a failed or degraded run, or one the person opened
    // themselves. A healthy run shows just the green phase, no chrome.
    const showToggle =
      hasOutput && (stack.phase === "failed" || stack.phase === "degraded" || detailsOpen);
    stackDetails.hidden = !showToggle;
    stackDetails.setAttribute("aria-expanded", String(detailsOpen && hasOutput));
    stackOutput.hidden = !(detailsOpen && hasOutput);
    if (!stackOutput.hidden) {
      stackOutput.textContent = stack.output.join("\n");
      stackOutput.scrollTop = stackOutput.scrollHeight;
    }
  }

  function renderStack(stack) {
    lastStack = stack;
    const { phase } = stack;
    stackSection.hidden = phase === "idle";
    if (phase === "idle") {
      continueButton.textContent = "Continue";
      freshButton.hidden = true;
      return;
    }
    const failed = phase === "failed";
    // A failure or warning carries its own explanation; otherwise the label describes the phase.
    const text = (failed || phase === "degraded" ? stack.message : null) || PHASE_LABELS[phase] || "";
    if (stackPhase.textContent !== text) {
      stackPhase.textContent = text;
      stackPhase.classList.remove("swap");
      void stackPhase.offsetWidth;
      stackPhase.classList.add("swap");
    }
    if (failed) stackPhase.setAttribute("data-tone", "error");
    else if (phase === "ready") stackPhase.setAttribute("data-tone", "ok");
    else stackPhase.removeAttribute("data-tone");

    renderProgress(stack);
    renderDetails(stack);
    // A blocked data copy may be skipped: the old installation stays intact
    // for a later retry either way.
    freshButton.hidden = !(failed && stack.freshStartAvailable === true);

    if (phase === "failed") continueButton.textContent = "Retry";
    else continueButton.textContent = "Continue";
    setBusy(!TERMINAL_PHASES.has(phase));
  }

  async function save(mode, url) {
    setBusy(true);
    lockMode(true);
    setStatus("");
    setLoader("Saving connection");
    try {
      const saved = await bridge.save({ mode, serverUrl: url });
      if (!saved.ok) setStatus(saved.error ?? "Could not save that address.", "error");
    } catch {
      setStatus("Could not save that address. Try again.", "error");
    } finally {
      setLoader(null);
      lockMode(false);
      setBusy(false);
    }
  }

  /**
   * Stores an entered E2B key OS-encrypted before the backend starts, so the
   * first launch already carries it. Empty means Skip for now. Returns false
   * when the key could not be stored, leaving the backend stopped.
   */
  async function storePendingKey() {
    if (e2bKey === null || e2bKey.value.trim() === "") return true;
    const key = e2bKey.value;
    e2bKey.value = "";
    if (bridge.runtime === undefined) {
      setStatus("Could not save the E2B key. Skip it for now and try again.", "error");
      return false;
    }
    const stored = await bridge.runtime.setKey(key);
    if (!stored.ok) {
      setStatus(
        stored.error ?? "Could not save the E2B key. Skip it for now and try again.",
        "error",
      );
      return false;
    }
    return true;
  }

  /** Wakes on the next pushed state, and on the timer if a push is ever missed. */
  function waitForStackChange() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (wakePoll === finish) wakePoll = null;
        resolve();
      };
      wakePoll = finish;
      setTimeout(finish, STACK_POLL_MS);
    });
  }

  /**
   * Follows a start already in flight until it settles. Leaving "This computer"
   * ends the follow so the stack becoming ready never saves over that choice.
   */
  async function followStack() {
    if (stackPolling) return;
    stackPolling = true;
    try {
      while (true) {
        const stack = await bridge.stack.state();
        if (stack === null) throw new Error("Setup is not active");
        // Checked after the await: a mode change during it hands the form to the change
        // handler, and a save it started must stay busy and must not be re-rendered over.
        if (selectedMode() !== "new") return;
        renderStack(stack);
        if (TERMINAL_PHASES.has(stack.phase)) {
          if (stack.phase === "ready" && selectedMode() === "new") {
            const current = await bridge.state();
            if (selectedMode() !== "new") return;
            defaultLocalUrl = current.defaultLocalUrl;
            await save("new", defaultLocalUrl);
          }
          return;
        }
        await waitForStackChange();
      }
    } catch {
      setStatus("Could not follow the local app. Try again.", "error");
      setBusy(false);
    } finally {
      stackPolling = false;
    }
  }

  async function runStack(fresh) {
    setStatus("");
    setBusy(true);
    // Existing instance has no key field; only This computer stores a key, and
    // only before its backend starts.
    if (selectedMode() === "new" && !(await storePendingKey())) {
      setBusy(false);
      return;
    }
    try {
      // A queued start still reads `idle`; leave the panel as it is and let the follow render it.
      const started = await bridge.stack.start(fresh === true ? { fresh: true } : undefined);
      if (started !== null && started.phase !== "idle") renderStack(started);
    } catch {
      setStatus("Could not start the local app. Try again.", "error");
      setBusy(false);
      return;
    }
    await followStack();
  }

  async function check() {
    const value = serverUrl.value;
    if (value.trim() === "") {
      setStatus("Enter a server address first.", "error");
      return null;
    }

    setBusy(true);
    setStatus("");
    setLoader("Checking connection");
    try {
      const result = await bridge.test(value);
      if (result.ok) {
        serverUrl.value = result.url;
        setStatus(`Sapphire answered at ${result.url}.`, "ok");
      } else {
        setStatus(result.error ?? "Could not reach that address.", "error");
      }
      return result;
    } catch {
      setStatus("Could not run the connection check. Try again.", "error");
      return null;
    } finally {
      setLoader(null);
      setBusy(false);
    }
  }

  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "mode") {
      syncPanels();
      // Unlock Continue/Check immediately; followStack exits on its next poll.
      if (selectedMode() !== "new") setBusy(false);
    }
  });

  checkButton.addEventListener("click", () => {
    void check();
  });

  stackDetails.addEventListener("click", () => {
    detailsOpen = !detailsOpen;
    detailsOpenedByFailure = false;
    if (lastStack !== null) renderDetails(lastStack);
  });

  freshButton.addEventListener("click", () => {
    void runStack(true);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (selectedMode() === "new") void runStack();
    else void save("existing", serverUrl.value);
  });

  /** Pushed state keeps progress moving even when the OS throttles this window's timers. */
  function watchStack() {
    bridge.stack.onChange(() => {
      wakePoll?.();
      // A follow that ended on an error restarts here instead of leaving the panel frozen;
      // hold the controls until it has rendered the state it is restarting on.
      if (!stackPolling && selectedMode() === "new") {
        setBusy(true);
        void followStack();
      }
    });
  }

  async function init() {
    if (bridge === undefined) {
      setStatus("Setup bridge unavailable.", "error");
      setBusy(true);
      return;
    }

    watchStack();
    try {
      const state = await bridge.state();
      if (state === null) throw new Error("Setup is not active");
      defaultLocalUrl = state.defaultLocalUrl;
      if (state.saved !== null) {
        const modeInput = document.querySelector(`input[name="mode"][value="${state.saved.mode}"]`);
        if (modeInput !== null) modeInput.checked = true;
        if (state.saved.mode === "existing") serverUrl.value = state.saved.serverUrl;
      }
      // A relaunch with the stack down starts it before this window opens; show that
      // attempt instead of the saved mode, and follow it while it is still running.
      const stack = await bridge.stack.state();
      const attached = stack !== null && stack.phase !== "idle";
      if (attached) document.getElementById("mode-new").checked = true;
      syncPanels();
      if (state.error) setStatus(state.error, "error");
      if (attached) {
        renderStack(stack);
        if (!TERMINAL_PHASES.has(stack.phase)) void followStack();
      } else if (selectedMode() === "existing") {
        serverUrl.focus();
      } else {
        continueButton.focus();
      }
    } catch {
      setStatus("Setup could not start. Quit Sapphire and try again.", "error");
      setBusy(true);
    }
  }

  void init();
})();
