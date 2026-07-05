// chart-hydrate.js — CSP-clean Chart.js hydration
// Served from /runtime/pi/chart-hydrate.js.
// Scans for <canvas data-chart> elements with a sibling
// <script type="application/json" class="pi-chart-spec"> containing a Chart.js config.

(function () {
  "use strict";

  // Wait for Chart.js to load (it sets window.Chart)
  function waitForChart(attempts) {
    if (typeof Chart !== "undefined") {
      return Promise.resolve(Chart);
    }
    if (attempts <= 0) {
      return Promise.reject(new Error("Chart.js not loaded"));
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        waitForChart(attempts - 1).then(resolve);
      }, 100);
    });
  }

  waitForChart(50)
    .then(function (Chart) {
      document.querySelectorAll("canvas[data-chart]").forEach(function (canvas) {
        var spec = canvas.parentElement?.querySelector(
          'script[type="application/json"].pi-chart-spec'
        );
        if (!spec) return;

        try {
          var config = JSON.parse(spec.textContent || "{}");
          if (config && config.type && config.data) {
            new Chart(canvas, config);
          }
        } catch (e) {
          console.warn("Failed to hydrate chart:", e);
        }
      });
    })
    .catch(function () {
      // Chart.js not available; skip hydration silently
    });
})();
