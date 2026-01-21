# OpenGCodeGen Project Context

## Project Overview
OpenGCodeGen is a static website designed to generate simple G-code for X-Carve CNC machines. The primary goal is to provide a lightweight, accessible tool for cutting out basic shapes without the overhead of full-featured CAD/CAM packages.

**Core Objectives:**
- Generate G-code for simple geometric shapes:
  - Squares
  - Rectangles
  - Circles
- Run entirely in the browser as a static site.
- Hostable on GitHub Pages.

## Technical Architecture
- **Type:** Static Web Application
- **Stack:** HTML, CSS, JavaScript
- **Deployment:** GitHub Pages

## Building and Running
As a static website, no complex build process is strictly required, though one may be added later (e.g., Vite/Webpack).

**Local Development:**
1.  Serve the root directory using a local HTTP server to avoid CORS/file protocol issues.
    *   Python: `python3 -m http.server`
    *   Node: `npx serve .`
2.  Open the local server URL in a web browser.

## Development Conventions
- **Code Style:** Standard HTML/CSS/JS formatting.
- **Logic:** G-code generation logic should be implemented in client-side JavaScript.
