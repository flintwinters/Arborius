import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Application mount point is missing");
}

app.textContent = "ARBORIUS // INITIALIZING";
