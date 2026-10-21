"use strict";

const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file-input");
const fileLabel = document.querySelector("#file-label");
const submitButton = document.querySelector("#submit-button");
const resultPanel = document.querySelector("#result");
const policiesContainer = document.querySelector("#policies");
const eventsBody = document.querySelector("#events");
const refreshButton = document.querySelector("#refresh-button");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultClass(decision) {
  return {
    PERMITIDO: "allowed",
    ALERTA: "warning",
    BLOQUEADO: "blocked",
    ERROR: "error",
  }[decision] || "idle";
}

function showResult(data) {
  const matches = data.matches?.length
    ? data.matches.map((match) => `${match.id}: ${match.name} (+${match.points})`).join(" · ")
    : "Ninguna regla activada";

  resultPanel.className = `result result--${resultClass(data.decision)}`;
  resultPanel.innerHTML = `
    <div class="result__heading">
      <strong>${escapeHtml(data.file || "Resultado del análisis")}</strong>
      <span class="badge">${escapeHtml(data.decision || "ERROR")}</span>
    </div>
    <p>${escapeHtml(data.message || "No se pudo procesar la solicitud.")}</p>
    <p><strong>Puntaje:</strong> ${escapeHtml(data.score ?? "-")} · <strong>Coincidencias:</strong> ${escapeHtml(matches)}</p>
  `;
}

async function loadPolicies() {
  const response = await fetch("/api/policies");
  if (!response.ok) throw new Error("No se pudieron cargar las políticas.");
  const policies = await response.json();

  policiesContainer.innerHTML = policies.map((policy) => `
    <article class="policy">
      <div class="policy__top"><code>${escapeHtml(policy.id)}</code><strong>+${escapeHtml(policy.points)}</strong></div>
      <h3>${escapeHtml(policy.name)}</h3>
      <p>${escapeHtml(policy.description)}</p>
    </article>
  `).join("");
}

async function loadEvents() {
  refreshButton.disabled = true;
  try {
    const response = await fetch("/api/events");
    if (!response.ok) throw new Error("No se pudieron cargar los eventos.");
    const events = await response.json();

    eventsBody.innerHTML = events.length ? events.map((event) => {
      const rules = event.matches.length ? event.matches.map((match) => match.id).join(", ") : "—";
      const time = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "medium" }).format(new Date(event.timestamp));
      return `
        <tr>
          <td>${escapeHtml(time)}</td>
          <td>${escapeHtml(event.file)}</td>
          <td>${escapeHtml(rules)}</td>
          <td>${escapeHtml(event.score)}</td>
          <td class="decision decision--${escapeHtml(event.decision)}">${escapeHtml(event.decision)}</td>
        </tr>
      `;
    }).join("") : '<tr><td colspan="5" class="empty">Todavía no hay eventos.</td></tr>';
  } catch (error) {
    eventsBody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
  } finally {
    refreshButton.disabled = false;
  }
}

fileInput.addEventListener("change", () => {
  fileLabel.textContent = fileInput.files[0]?.name || "Selecciona un archivo de prueba";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("archivo", file);
  submitButton.disabled = true;
  submitButton.textContent = "Analizando…";

  try {
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await response.json();
    showResult(data);
    await loadEvents();
  } catch {
    showResult({ decision: "ERROR", message: "No fue posible conectar con el servicio DLP." });
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Analizar y transferir";
  }
});

refreshButton.addEventListener("click", loadEvents);

Promise.all([loadPolicies(), loadEvents()]).catch((error) => {
  showResult({ decision: "ERROR", message: error.message });
});
