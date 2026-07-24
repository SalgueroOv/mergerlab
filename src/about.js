import { initAboutI18n } from "./aboutI18n.js";

async function init() {
  const t = (await initAboutI18n()).t;
  const info = await window.aboutAPI.getAppInfo();

  document.getElementById("page-title").textContent = t("about.windowTitle");
  document.getElementById("label-author").textContent = t("about.author");
  document.getElementById("label-license").textContent = t("about.license");
  document.getElementById("label-year").textContent = t("about.year");
  document.getElementById("replay-tour-btn").textContent = t("about.replayTour");

  document.getElementById("app-name").textContent = info.name;
  document.getElementById("app-version").textContent = t("about.version", { version: info.version });

  const tagline = document.getElementById("app-tagline");
  if (info.description) {
    tagline.textContent = info.description;
  } else {
    tagline.style.display = "none";
  }

  const authorEl = document.getElementById("app-author");
  if (info.authorUrl) {
    const authorLink = document.createElement("a");
    authorLink.href = "#";
    authorLink.className = "author-link";
    authorLink.textContent = info.author;
    authorLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.aboutAPI.openExternal(info.authorUrl);
    });
    authorEl.replaceChildren(authorLink);
  } else {
    authorEl.textContent = info.author;
  }

  document.getElementById("app-license").textContent = info.license || "—";
  document.getElementById("app-year").textContent = info.year;

  const repoLink = document.getElementById("repo-link");
  if (info.repository) {
    repoLink.textContent = info.repository.replace(/^https?:\/\//, "");
    repoLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.aboutAPI.openExternal(info.repository);
    });
  } else {
    repoLink.style.display = "none";
  }

  document.getElementById("replay-tour-btn").addEventListener("click", () => {
    window.aboutAPI.replayOnboarding();
  });
}

init();

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.aboutAPI.closeWindow();
  }
});
