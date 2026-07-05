// viewer-live.js — SSE client for live reload
// Served from /runtime/pi/viewer-live.js, included in the gallery and artifact pages.

(function () {
  "use strict";

  const currentUrl = window.location;
  const eventSource = new EventSource("/events");

  eventSource.addEventListener("update", function (event) {
    try {
      const data = JSON.parse(event.data);
      if (data.id) {
        const artifactId = document.currentScript?.getAttribute("data-artifact-id");
        if (artifactId && artifactId === data.id) {
          // Reload only if the current page shows this artifact
          window.location.reload();
          return;
        }
      }
      // Gallery page or unrelated artifact: reload if we're on /viewer
      if (currentUrl.pathname === "/viewer" || currentUrl.pathname === "/") {
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  });

  eventSource.addEventListener("navigate", function (event) {
    try {
      const data = JSON.parse(event.data);
      if (data.path && currentUrl.pathname !== data.path) {
        window.location.href = data.path;
      }
    } catch {}
  });

  eventSource.addEventListener("error", function () {
    // Reconnect on error; the server sets retry: 2000
  });
})();
