"use strict";
const output = document.getElementById("result");
async function sendFiles(files) {
  const body = new FormData();
  for (const file of files) body.append("archivo", file);
  const response = await fetch("/upload", { method: "POST", body });
  const result = await response.json();
  output.textContent = response.ok ? `Recibidos: ${result.receipts.length} archivo(s).` : result.error;
}
document.getElementById("file-form").addEventListener("submit", (event) => { event.preventDefault(); sendFiles(document.getElementById("file").files).catch((e) => { output.textContent = e.message; }); });
document.getElementById("text-form").addEventListener("submit", async (event) => { event.preventDefault(); const response = await fetch("/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: document.getElementById("text").value }) }); output.textContent = response.ok ? "Texto recibido por el destino." : "No se pudo enviar el texto."; });
document.getElementById("drop").addEventListener("dragover", (event) => event.preventDefault());
document.getElementById("drop").addEventListener("drop", (event) => { event.preventDefault(); sendFiles(event.dataTransfer.files).catch((e) => { output.textContent = e.message; }); });
