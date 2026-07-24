(function (global) {
  function isStateChampionshipMeet(meet) {
    if (!meet) return false;
    const flag = meet.is_state_championship;
    return flag === true || flag === "true" || flag === "yes" || flag === 1;
  }

  function filterPastStateChampionshipMeets(meets) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return (meets || [])
      .filter((meet) => {
        if (!isStateChampionshipMeet(meet) || !meet.date) return false;
        const datePart = String(meet.date).split("T")[0];
        const meetDate = new Date(datePart + "T00:00:00");
        return meetDate < today;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatMeetDate(dateStr) {
    if (!dateStr) return "Date TBD";
    const parts = String(dateStr).split("T")[0].split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    return new Date(dateStr).toLocaleDateString();
  }

  function renderStateChampionshipSection(container, meets, options) {
    if (!container) return;

    const sportPath = options?.sportPath || "CrossCountry";
    const past = filterPastStateChampionshipMeets(meets);

    if (!past.length) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }

    container.hidden = false;
    const cards = past
      .map((meet) => {
        const slug = encodeURIComponent(meet.slug || meet.id);
        const href = `/${sportPath}/meet.html?slug=${slug}`;
        const season =
          meet.season && options?.showSeason
            ? `<span class="state-championship-season">${escapeHtml(meet.season)}</span>`
            : "";

        return `
          <a href="${href}" class="meet-card state-championship-card">
            <div class="state-championship-badge">🏆 State Championship</div>
            <h3 class="meet-card-title">${escapeHtml(meet.name || "State Championship")}</h3>
            <p class="meet-card-date">📅 ${formatMeetDate(meet.date)}</p>
            ${meet.location ? `<p class="meet-card-location">📍 ${escapeHtml(meet.location)}</p>` : ""}
            ${season}
          </a>`;
      })
      .join("");

    container.innerHTML = `
      <section class="state-championship-section">
        <h2 class="section-title">Past State Championship Results</h2>
        <p class="state-championship-subtitle">Full results from past West Virginia state championship meets.</p>
        <div class="meet-grid">${cards}</div>
      </section>`;
  }

  global.MSMStateChampionships = {
    isStateChampionshipMeet,
    filterPastStateChampionshipMeets,
    renderStateChampionshipSection,
  };
})(window);
