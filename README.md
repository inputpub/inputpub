# input.pub

**input here, publish anywhere** — a minimalist Markdown editor that publishes/sends your content to multiple destinations.

- ✍️ Write once in a clean [Milkdown](https://milkdown.dev) WYSIWYG editor (auto-saved locally)
- 🚀 Send to **X**, **GitHub Gist**, **Email**, and **ChatGPT**
- 🧩 Plugin model — add a destination = one file + one line in [`frontend/src/destinations`](frontend/src/destinations)
- 🪶 Pure frontend, no backend, no login. API targets use your own token stored in the browser.

## Develop

```bash
cd frontend
npm install
npm run dev
```

## Deploy

Pushes to `main` auto-deploy to GitHub Pages via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), served at [input.pub](https://input.pub).
